---
title: "docker and docker compose"
pubDate: 2025-12-18
description: "How to use docker and docker compose for small projects"
draft: true
---

## What is this about?

When working on personal projects, web applications in particular, you need to know how to code, think of the architecture, design, and many other things. But also you want to have good development setup that is easy to recreate on another machine and a way to run your app in production that is not pushing compiled binaries to the server with SSH. On the other hand, you do not want to overcomplicate things, as it is a small project, maybe even just a proof of concept.

I am going to share my setup, that I use in such cases and find it a good balance between complexity and ease of use. In the end we will have setup that allows to have one command that will start everything needed for local development, reload on updates to both server and frontend code, and additionally a command to run everything in production mode.

What I do is run everything in a Docker using Docker Compose, both for development and in production. This can be scaled to using Kubernetes if you eventually need more than one server, it is possible to CI/CD, and many more, but this is out of scope for this blog post.

## Where we’re going

We’ll build a small web application with:

- PostgreSQL
- Backend API (Node.js)
- Frontend (React)
- Reverse proxy
- One-command startup for:
  - local development (hot reload)
  - production

Later, we’ll add alternative backends (Go, Rust, Python) to the same setup, just to make this post useful for people who use these.

## Docker and Docker Compose

I assume, you already know this, but I will still sum it up shortly. Docker is a way to create containers and run them. You can think of containers as of virtual machines, even though it is not fully technically correct. Typically you use two types of docker containers: ones that you build yourself from the Dockerfiles and prebuilt ones from the public registries, such as Docker Hub. It is also possible to run your own registry or push your container images to the public registry.

Docker Compose is a way to describe several containers that should run together.

## PostgreSQL

It is possible to run containers using the Docker CLI, but for this post, I will only run them using Docker Compose.

Most projects need a database, so let's start with running [PostgreSQL](https://www.postgresql.org/).

Let's create our `docker-compose.yml` file. For now it will only run PostgreSQL database.

```yml
  db:
    image: postgres
    restart: always
    environment:
      POSTGRES_USER: $POSTGRES_USER
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: $POSTGRES_DB
    volumes:
      - postgres_data:/var/lib/postgresql
    ports:
      - 5432:5432

volumes:
  postgres_data:
```

Also, we will need an `.env` file:

```sh
POSTGRES_DB=db
POSTGRES_USER=psql_user
POSTGRES_PASSWORD=psql_password
```

With these files in place, we can start and stop the container using these commands:

```sh
# start the containers and show it's logs in the console, stop the containers with Ctrl-C
docker compose up

# start the conainers in the background
docker compose up --detach

# stop the containers
docker compose down
```

If you have `pgsql` tool installed you can connect to the running PostgresSQL like this:

```sh
psql postgres://psql_user:psql_password@localhost/db
```

Inside you can run `SELECT version();` to just see if it works correctly, and `\q` to quit.

## Adminer

We can add [Adminer](https://www.adminer.org/) to our setup. It is a lightweight database administration tool, that can come handy if you want to do something with your database manually.

Let's update our `docker-compose.yml` file:

```yml
services:
  db:
    image: postgres
    restart: always
    environment:
      POSTGRES_USER: $POSTGRES_USER
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: $POSTGRES_DB
    volumes:
      - postgres_data:/var/lib/postgresql
    ports:
      - 5432:5432

  adminer:
    image: adminer
    restart: always
    environment:
      ADMINER_DEFAULT_SERVER: db
    ports:
      - 8080:8080

volumes:
  postgres_data:
```

After restarting the containers with `docker compose down` and `docker compose up` we should have both PostgreSQL and Adminer running.
Visit http://localhost:8080 to get to the Adminer interface. You will need to select PostgresSQL and provide credentials we specified in the `.env` file to get to the database.

## Docker-compose.yml explained

Let's look at the docker compose file we created and see what it means.

We have specified that we need to services, named `db` and `adminer`. These services are available in the internal docker network by these names.

Both services specify images to use: `postgres` and `adminer`. They will be downloaded from [Docker Hub](https://hub.docker.com/) on the first run. It is possible to specify versions, for example we could have wrote `postgres:18` or `postgres:18.1-alpine3.23` if we wanted to be more specific.

`restart:always` is the restart policy. With this setting Compose will try to restart the container if it stops for any reason.

It is possible to specify environment variables that will be available inside the container. For PostgreSQL we passed some environment variables from the host (specified in the `.env` file):

```yml
environment:
  POSTGRES_USER: $POSTGRES_USER
  POSTGRES_PASSWORD: $POSTGRES_PASSWORD
  POSTGRES_DB: $POSTGRES_DB
```

For the Adminer we specified a concrete value, namely we the server name to `db` which is the service name of PostgreSQL service.

```yml
environment:
  ADMINER_DEFAULT_SERVER: db
```

PostgreSQL has a `volumes` keys, and also we have `postgres_data` specified at the end of file:

```yml
    volumes:
      - postgres_data:/var/lib/postgresql

volumes:
  postgres_data:
```

This created a named volume and mounted it to the container under the specified mount point. It is also possible to mount the file or the folder from the host to the container. The syntax is the same, but you need to specify path on host relative to the docker compose file in the left part.

In case of the PostgreSQL this allows to separate the database data from the container. Without this data will live inside the container and updating the container in any way can delete the data. Additionally, you can for example mount the same volume into another container for backup.

Finally, both containers have ports specified. These are ports that are exposed outside the docker. It is specified in form `host_port:container_port`.

```yml
ports:
  - 8080:8080
```

## Node.js backend

Let's now put a Node.js powered backend into container. This time we will not use a predefined container image from Docker Hub, but created our own small application to run.

#### Source code

Before creating a container we need to have an app that we will run in that container. Let's start with the simple Node.js/Express app. It will connect to the database and do something simple with it.

Let's create a folder named `node-app` and run the following commands:

```
mkdir node-app
cd node-app
npm init -y
npm add express pg-promise
```

We will need to edit the created `package.json` file. Let's modify the `scripts` sections to look like this:

```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
```

This defines two commands: `npm start` will start the app in production mode, and `npm run dev` will start the app in the development mode. Development mode runs the same, but restarts the application every time we change the source code.

Finally let's create the file `src/index.js` with the source code for our application. It is a very simple application that connects to the database, stores a counter there, and increment the counter on every access to the `/` route.

```js
const express = require("express");
const pgp = require("pg-promise")();

const app = express();
const port = process.env.PORT || 3000;
const POSTGRES_HOST = process.env.POSTGRES_HOST || "localhost";
const POSTGRES_PORT = process.env.POSTGRES_PORT || 5432;
const POSTGRES_USER = process.env.POSTGRES_USER || "postgres";
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "postgres";
const POSTGRES_DB = process.env.POSTGRES_DB || "postgres";

// Initialize DB connection
const db = pgp(
  `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`
);

// Create table if not exists and ensure a single row
async function initDB() {
  try {
    await db.none(`
      CREATE TABLE IF NOT EXISTS counter (
        id SERIAL PRIMARY KEY,
        count INT NOT NULL
      );
    `);

    // Ensure there is exactly one row
    const row = await db.oneOrNone("SELECT * FROM counter LIMIT 1");
    if (!row) {
      await db.none("INSERT INTO counter (count) VALUES (0)");
    }

    console.log("Database initialized");
  } catch (err) {
    console.error("Error initializing database:", err);
    process.exit(1);
  }
}

// Route to increment counter
app.get("/", async (req, res) => {
  try {
    // Increment counter atomically and return new value
    const updated = await db.one(`
      UPDATE counter
      SET count = count + 1
      WHERE id = (SELECT id FROM counter LIMIT 1)
      RETURNING count;
    `);

    res.send(`Counter value: ${updated.count}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating counter");
  }
});

// Start server after DB initialization
initDB().then(() => {
  app.listen(port, () => {
    console.log(`App listening on port ${port}`);
  });
});
```

Let's check the application by running `npm run dev` in the `node-app` folder. While the application is running, you can access http://localhost:3000 and it should show the counter, and increment it every time you update the page. Note that our containers should be running for the app to be able to connect to the database.

### Putting our application into container

Running application separately from the docker is not handy, so let's add it to the docker-compose setup.

We cannot just fetch a preexisting image for our application, instead we need to create our image. To do this, we need to create a file, named `Dockerfile`:

```dockerfile
FROM node:24-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY src src

# Start the server
CMD ["npm", "start"]
```

This file defines a new container. We can read it line by line:

- `FROM node:24-alpine` - container is based on the official Node.js image from the docker hub. We use the current LTS version, which is 24, and the version of the container that is based on Alpine Linux, as these tend to be leaner.
- `WORKDIR /app` - create a folder `/app` inside the container and select it as current folder.
- `COPY package*.json ./` - copy files `package.json` and `package-lock.json` into the container.
- `RUN npm install` - run `npm install` inside the container to install the dependencies.
- `COPY src src` - copy `src` folder from the host into the container.
- `CMD ["npm", "start"]` - when the container is run, it will by default run the command `npm start`.

It is worth mentioning that Docker makes snapshots of the image after every command and reuses these during next builds if nothing has changed. We first copy the `package.json` file and install the dependencies, and only after that copy the rest of the source code. This allows Docker to rebuild the image much faster if dependencies did not change as it will reuse everything up to the `COPY src src` step.

### Add container to the Docker Compose

We can build and run the container with our app using docker CLI, but instead let's add to the `docker-compose.yml` file.

```yml
node-app:
  build: ./node-app
  restart: always
  ports:
    - "3000:3000"
  environment:
    POSTGRES_HOST: db
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
```

Now if we run `docker compose up` it will build our container and run it. Everything should work just the same: visit http://localhost:3000 and it should display and increment the counter.

If you have changed the sources, docker compose will not detect this automatically, because of this it is better to always start the containers with the `docker compose up --build` command.

### Separate setup for development

During development, we change the source code often, and it comes handy to automatically restart the server on every source code change. We even have the `npm run dev` command that does exactly this already.

But it will not work inside Docker, because source files are copied inside the container during the build, so you will need to restart and rebuild everything to apply source code changes. It is not hard, just run `docker compose down` and then `docker compose up --detach --build` and that is all, but we can do better.

Let's create a file named `docker-compose.dev.yml`:

```yml
services:
  node-app:
    volumes:
      - ./node-app/src:/app/src
    command: ["npm", "run", "dev"]
```

This file will be used to override some values in our original `docker-compose.yml` file. This can be done with this command:

```sh
docker-compose --file docker-compose.yml --file docker-compose.dev.yml up --build
```

We mount the `src` folder of our app into the container instead of the copied `src` folder, it allows the app inside the container to see the modified sources. Additionally we override the start command defined in the dockerfile with `npm run dev`.

Now if you modify the source code of the application it gets applied immidiately. You can try to modify the message that is displayed with the counter to see this in action.

### Do not expose postgres

Now, that our app runs inside the Docker, we do not need to expose PostgresSQL ports. Let's remove it from the `docker-compose.yml`:

```diff
-    ports:
-      - 5432:5432
```

## Scripts

Depending on the system you we can create shell scripts or batch files, so that we do not forget the exact commands needed to start and stop the containers. I'll provide the files that should work on Linux and MacOS.

`start.sh`:

```sh
#!/bin/bash
docker-compose up --build --detach
```

`start-dev.sh`:

```sh
#!/bin/bash
docker-compose --file docker-compose.yml --file docker-compose.dev.yml up --build --detach
```

`stop.sh`:

```sh
#!/bin/bash
docker-compose down
```

Just do not forget to add execution permissions to these files:

```sh
chmod +x start.sh start-dev.sh stop.sh
```

### Intermediate results

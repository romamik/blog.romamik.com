---
title: "todo"
pubDate: 2025-12-18
description: "todo"
draft: true
---

## What is this about?

When working on personal projects, web applications in particular, you need to know how to code, think of the architecture, design, and many other things. But also you want to have good development setup that is easy to recreate on another machine and a way to run your app in production that is not pushing compiled binaries to the server with SSH. On the other hands, you do not want to overcomplicate things, as it is a small project, maybe even just a proof of concept.

I am going to share my setup, that I use in such cases and find it a good balance between complexity and ease of use. In the end we will have setup that allows to have one command that will start everything needed for local development, reload on updates to both server and frontend code, and additionally a command to run everything in production mode.

What I do is run everything in a Docker using Docker Compose, both for development and in production. This can scale to using Kubernetes if you eventually need more than one server, it is possible to add some CI/CD setup to this, but this is out of scope for this blog post.

## Docker and Docker Compose

I assume, you already know this, but I will still sum it up shortly. Docker is a way to create containers and run them. You can think of them as separate virtual machines, even though it is not fully technically correct. Typically you use two types of docker containers: ones that you build yourself from the Dockerfiles and prebuilt ones from the public registry, such as Docker Hub.

Docker Compose is a way to describe several containers that should run together. 

### Running containers from the registry

I will not show how to run containers without a registry. It is possible, and sometimes it can come handy, but actually in my own work I do this rarely. So let's start with simple docker compose setup that will just run some container. Most of the projects require some sort of the database, so we can run PostgreSQL.

Let's create a file named `docker-compose.yml`

```yml
services:

  db:
    image: postgres
    restart: always
    environment:
      POSTGRES_USER: $POSTGRES_USER
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: $POSTGRES_DB
    ports:
      - 5432:5432

  adminer:
    image: adminer
    restart: always
    environment:
      ADMINER_DEFAULT_SERVER: db
    ports:
      - 8080:8080
```

Also, we will need an `.env` file:
```sh
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

This docker compose file describes two services named `db` and `adminer`. `db` is the PostgreSQL server and `adminer` is the db administration tool. Both will be taken from the [docker hub](https://hub.docker.com).

To start the containers we can just run:
```
docker-compose up
```
or 
```
docker-compose up --detach
```

Both do the same thing: start the containers specified in the docker-compose file. But the detach one does not lock your terminal.

To stop the containers you can just hit `Ctrl-C` if they are not detached, or run
```
docker-compose down
```

With this example, when the containers are running you can visit http://localhost:8080 and see and the Adminer interface there. 

You may notice that adminer connects to the PostgreSQL using hostname "db" which matches the service name. This is because they are both connected to the docker network and docker internal dns service resolves the names of the services. It is also worth noting that docker creates separate networks for different setups, by default based on the folder where the docker-compose file is situated, so even if you have similarly named containers in different docker-compose setups they will not see each other. To access this internal network from our machine we exposed the 8080 port of the adminer service, and because of that we can access it on localhost.

### Defining your own container

#### Creating a simple web app with Node.js

Before creating a container we need to have an app that will be run in that container. Let's start with the simple Node.js/Express app. I will cover other options later, but for now we will create a very simple application that will still connect to our database.

Let's create a folder named `node-app` and run the following commands there:
```
mkdir node-app
cd node-app
npm init -y
npm add express pg-promise
```

We will need to edit the created `package.json` file. Let's modify the scripts sections to like this:
```json
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
```

And finally create the file `src/index.js` with the source code for our application. It is a very simple application that connects to the database and stores a counter there. Every access to the `/` route increments the counter. 

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

Now we can run `npm start` or `npm run dev` to start the application. The `npm run dev` command is different, because it will automatically restart the server when source code changes. By default, it connects to the database on the localhost, and if we have our docker compose running it should be working just fine. To test the application we can start both docker-compose and our app, and in visit http://localhost:3000 in the browser. Every page update should increment the displayed counter.

#### Putting our application into Docker

Running application separately from the docker is not handy, so let's add it to the docker-compose setup. 

First let's create a file named `Dockerfile`:
```dockerfile
FROM node:25-alpine

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

This defines a new container, that is based on the Node.js image from the Docker Hub. In my opinion it mostly describes itself, but in short it does this: 
* Create a folder `/app` inside the container and select it as current folder.
* Copy files `package.json` and `package-lock.json` into the container.
* Run `npm install` inside the container to install the dependencies.
* Copy `src` folder into the container.
* Specify a command to run when the container is started.

It is worth mentioning that Docker makes snapshots of the image after every command and reuses these during next builds if nothing has changed. We first copy the `package.json` file and install the dependencies, and only after that copy the rest of the source code. This allows Docker to rebuild the image much faster if dependencies did not change as it will reuse everything up to the `COPY src src` step.

#### Add container to the Docker Compose

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

Now if we run `docker-compose up` it will build our container and run it. Everything should work just the same: visit http://localhost:3000 and it should display and increment the counter.

If you have changed the sources, docker compose will not detect this automatically, because of this it is better to always start the containers with the `docker-compose up --build` command.

##### Do not expose postgres

Now, that our app runs inside the Docker, we do not need to expose PostgresSQL ports. Let's remove it from the `docker-compose.yml`:
```yml
  db:
    image: postgres
    restart: always
    environment:
      POSTGRES_USER: $POSTGRES_USER
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: $POSTGRES_DB
    # ports:
    #   - 5432:5432
```

#### Separate setup for development

During development, we change the source code often, and it comes handy to automatically restart the server on every source code change. We even have the `npm run dev` command that does exactly this already.

But it will not work inside Docker, because source files are copied inside the container during the build, so you will need to restart and rebuild everything to apply source code changes. It is not hard, just run `docker-compose down` and then `docker-compose up --detach --build` and that is all, but we can do better.

Let's create a file named `docker-compose.dev.yml`:
```yml
services:
  node-app:
    volumes:
      - ./node-app/src:/app/src
    command: ["npm", "run", "dev"]
```

It is supposed to override/add parameters to the `docker-compose.yml` file that we already have. We use it with this command:
```sh
docker-compose --file docker-compose.yml --file docker-compose.dev.yml up --build
```

We mount the `src` folder of our app into the container instead of the copied `src` folder, it allows the app inside the container to see the modified sources. Additionally we override the start command defined in the dockerfile with `npm run dev`.

Now if you modify the source code of the application it gets applied immidiately. You can try to modify the message that is displayed with the counter to see this in action.

#### Scripts

Depending on the system you we can create shell scripts or batch files, so that we do not forget the exact commands needed to start and stop the containers.

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

### Intermediate results


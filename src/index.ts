import Server from "./server";

process.on('uncaughtException', error => {
    console.log('uncaughtException', error);
});

process.on('unhandledRejection', error => {
    console.log('unhandledRejection', error);
});

const server = new Server();
server.start().then((server) => {
    if (server.listening) console.log(`Listen 27770`);
});
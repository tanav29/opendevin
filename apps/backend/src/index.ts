import { createApp } from "./app.js";
import { config } from "./config.js";
import { createHttpServer } from "./server.js";

const app = createApp();
const { server } = createHttpServer(app);

server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

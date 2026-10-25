import { config } from "./config.js";
import server from "./server.js";

server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

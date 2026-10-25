import { config } from "./config.js";
import server from "./server.js";

if (!process.env.VERCEL) {
  server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}

export default server;

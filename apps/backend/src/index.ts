import { config } from "./config.js";
import { createApp } from "./application.js";
import { attachTerminal } from "./server.js";

const app = createApp();

if (!process.env.VERCEL) {
  const server = app.listen(config.port, (error) => {
    if (error) throw error;
    console.log(`API listening on http://localhost:${config.port}`);
  });
  attachTerminal(server);
}

export default app;

import { eveChannel } from "eve/channels/eve";
import { localDev, none } from "eve/channels/auth";

// OpenDevin is a single-user tool without accounts: accept the local dev
// server and anonymous browser sessions.
export default eveChannel({
  auth: [localDev(), none()],
});

// Worker entry. workerd requires the entry module to expose only the handler
// (`default`), so all routing/factory code lives in app.ts and is imported here.

import { createApp } from "./app";

export default createApp();

import app from "./fetchio-app";
import {env} from "./config/env";
app.listen(env.port,"0.0.0.0",()=>console.log(`Fetchio running at http://localhost:${env.port}`));
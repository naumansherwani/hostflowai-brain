import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import manifestRouter from "./manifest.js";
import changelogRouter from "./changelog.js";
import streamRouter from "./stream.js";
import whoamiRouter from "./whoami.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(manifestRouter);
router.use(changelogRouter);
router.use(streamRouter);
router.use(whoamiRouter);

export default router;

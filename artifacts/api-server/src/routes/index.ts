import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientguardRouter from "./clientguard";
import clientguardWorkflowsRouter from "./clientguard-workflows";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientguardRouter);
router.use(clientguardWorkflowsRouter);

export default router;

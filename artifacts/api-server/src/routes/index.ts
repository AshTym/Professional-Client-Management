import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientguardRouter from "./clientguard";
import clientguardWorkflowsRouter from "./clientguard-workflows";
import clientguardOperationsRouter from "./clientguard-operations";
import clientguardIntegrationsRouter from "./clientguard-integrations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientguardRouter);
router.use(clientguardWorkflowsRouter);
router.use(clientguardOperationsRouter);
router.use(clientguardIntegrationsRouter);

export default router;

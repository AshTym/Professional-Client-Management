import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientguardRouter from "./clientguard";
import clientguardWorkflowsRouter from "./clientguard-workflows";
import clientguardOperationsRouter from "./clientguard-operations";
import clientguardIntegrationsRouter from "./clientguard-integrations";
import clientguardEngagementsRouter from "./clientguard-engagements";
import clientguardTrustRouter from "./clientguard-trust";
import clientguardCloseoutRouter from "./clientguard-closeout";
import clientguardReportsRouter from "./clientguard-reports";
import clientguardPracticeSettingsRouter from "./clientguard-practice-settings";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contactRouter);
router.use(clientguardRouter);
router.use(clientguardWorkflowsRouter);
router.use(clientguardOperationsRouter);
router.use(clientguardIntegrationsRouter);
router.use(clientguardEngagementsRouter);
router.use(clientguardTrustRouter);
router.use(clientguardCloseoutRouter);
router.use(clientguardReportsRouter);
router.use(clientguardPracticeSettingsRouter);

export default router;

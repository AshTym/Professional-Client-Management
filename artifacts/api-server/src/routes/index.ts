import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientguardRouter from "./clientguard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientguardRouter);

export default router;

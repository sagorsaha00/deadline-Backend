import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { chatWithAi } from "./aiController.js";

const router = Router();

router.use(authenticate);
router.post("/chat", chatWithAi);

export default router;

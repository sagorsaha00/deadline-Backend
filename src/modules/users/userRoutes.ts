import { Router } from "express";
import { getUsers, updateProfile } from "./userController.js";
import { authenticate } from "../../middleware/auth.js";

const router = Router();

router.use(authenticate);
router.get("/", getUsers);
router.patch("/profile", updateProfile);

export default router;

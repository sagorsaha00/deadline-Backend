import { Router } from "express";
import { getUsers, updateProfile, updateUserRole } from "./userController.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

const router = Router();

router.use(authenticate);
router.get("/", getUsers);
router.patch("/profile", updateProfile);
router.patch("/:id/role", authorizeRoles(Role.ADMIN), updateUserRole);

export default router;

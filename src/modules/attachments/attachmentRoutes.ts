import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.js";
import {
  uploadAttachment,
  getTaskAttachments,
  deleteAttachment,
} from "./attachmentController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Allow images and PDFs
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and PDF files are supported."));
    }
  },
});

const router = Router();

router.use(authenticate);

router.post("/upload", upload.single("file"), uploadAttachment);
router.get("/task/:taskId", getTaskAttachments);
router.delete("/:id", deleteAttachment);

export default router;

import { prisma } from "../config/db.js";

async function clean() {
  await prisma.task.deleteMany({ where: { title: { startsWith: "Test Verification Task" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "test_" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "forged_" } } });
  console.log("Cleanup complete");
}

clean().finally(() => prisma.$disconnect());

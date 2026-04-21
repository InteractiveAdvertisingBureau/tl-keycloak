import express from "express";
import cors from "cors";

const PORT = Number(process.env.PORT || 4002);
const app = express();
app.use(cors());
app.use(express.json());

app.get("/admin/health", (_req, res) => {
  res.json({ status: "ok", service: "mock-admin" });
});

app.get("/user/profile", (req, res) => {
  const userId = req.headers["x-user-id"] || "unknown";
  const email = req.headers["x-user-email"] || "unknown";
  res.json({
    userId,
    email,
    displayName: `User ${userId}`,
  });
});

app.listen(PORT, () => {
  console.log(`mock-service listening on ${PORT}`);
});

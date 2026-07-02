import dotenv from "dotenv";

dotenv.config({ quiet: true });

export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.7);

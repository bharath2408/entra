import nodemailer from "nodemailer";
import logger from "./logger";
import * as dotenv from "dotenv";

dotenv.config();

export async function sendOtpEmail(to: string, otp: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    auth: {
      user: process.env.NEXT_PUBLIC_EMAIL_ID!,
      pass: process.env.NEXT_PUBLIC_EMAIL_PASSWORD!,
    },
  });

  const mailOptions = {
    from: process.env.NEXT_PUBLIC_EMAIL_ID!,
    to,
    subject: "Your Entra ID OTP Code",
    text: `Your OTP for login is: ${otp}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`OTP sent to ${to}`);
  } catch (err) {
    logger.error("Failed to send OTP email", err);
    throw new Error("Failed to send OTP");
  }
}

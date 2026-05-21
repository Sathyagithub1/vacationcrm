import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/modules/audit/audit.service";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Rate limit: 5 attempts per 15 minutes per email
        const email = credentials.email.toLowerCase();
        const rlKey = `login:${email}`;
        const rlResult = await rateLimit(rlKey, 5, 15 * 60 * 1000);

        if (!rlResult.success) {
          // Log the lockout to audit log
          const existingUser = await prisma.user.findFirst({
            where: { email, isActive: true },
          });
          if (existingUser) {
            await logAudit({
              tenantId: existingUser.tenantId,
              userId: existingUser.id,
              action: "auth.lockout",
              entityType: "User",
              entityId: existingUser.id,
              newValue: { reason: "Too many failed login attempts", email },
            }).catch(() => {});
          }
          throw new Error("Too many login attempts. Please try again in 15 minutes.");
        }

        const user = await prisma.user.findFirst({
          where: {
            email: credentials.email,
            isActive: true,
          },
        });

        if (!user) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!isValid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          departmentId: user.departmentId,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.departmentId = user.departmentId;
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.tenantId = token.tenantId;
      session.user.departmentId = token.departmentId;
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  secret: process.env.NEXTAUTH_SECRET,
};

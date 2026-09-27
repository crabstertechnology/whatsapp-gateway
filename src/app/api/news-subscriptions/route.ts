import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

// GET: List all news subscriptions
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        // Auto-seed default subscriber if table is completely empty
        const count = await prisma.newsSubscription.count();
        if (count === 0) {
            await prisma.newsSubscription.create({
                data: {
                    name: "Primary WhatsApp",
                    jid: "57342326489321@lid",
                    deliveryTime: "07:30",
                    enabled: true
                }
            });
        }

        const subscriptions = await prisma.newsSubscription.findMany({
            orderBy: { createdAt: "asc" }
        });

        return NextResponse.json({
            status: true,
            data: subscriptions
        });
    } catch (error: any) {
        console.error("GET news subscriptions error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}

// POST: Add new subscriber for daily news
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        let { jid, name, deliveryTime, enabled } = body;

        if (!jid) {
            return NextResponse.json({ status: false, message: "Recipient number or group is required" }, { status: 400 });
        }

        // Clean & format JID
        jid = jid.trim();
        if (!jid.includes("@")) {
            // Clean phone number (remove spaces, +, hyphens)
            const cleanDigits = jid.replace(/\D/g, "");
            jid = `${cleanDigits}@s.whatsapp.net`;
        }

        const time = deliveryTime || "07:30";

        const newSub = await prisma.newsSubscription.create({
            data: {
                name: name ? name.trim() : (jid.endsWith("@g.us") ? "Group Recipient" : "Contact"),
                jid,
                deliveryTime: time,
                enabled: enabled !== undefined ? enabled : true
            }
        });

        return NextResponse.json({
            status: true,
            message: "News subscriber added successfully",
            data: newSub
        });
    } catch (error: any) {
        console.error("POST news subscription error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}

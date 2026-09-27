import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { sendMorningNews } from "@/lib/news-service";

// POST: Trigger test send of live news briefing to a specific JID
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        let { jid } = body;

        if (!jid) {
            return NextResponse.json({ status: false, message: "Recipient JID is required" }, { status: 400 });
        }

        jid = jid.trim();
        if (!jid.includes("@")) {
            jid = `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
        }

        const success = await sendMorningNews(jid);

        if (!success) {
            return NextResponse.json({
                status: false,
                message: "Failed to send test briefing. Please ensure WhatsApp session is connected."
            }, { status: 500 });
        }

        return NextResponse.json({
            status: true,
            message: `Live news briefing successfully sent to ${jid}`
        });
    } catch (error: any) {
        console.error("Test send news error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}

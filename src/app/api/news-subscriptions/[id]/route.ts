import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

// PUT: Update subscriber (toggle active, change time, change name/jid)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { name, deliveryTime, enabled, jid } = body;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (deliveryTime !== undefined) updateData.deliveryTime = deliveryTime;
        if (enabled !== undefined) updateData.enabled = enabled;
        if (jid !== undefined) {
            let cleanJid = jid.trim();
            if (!cleanJid.includes("@")) {
                cleanJid = `${cleanJid.replace(/\D/g, "")}@s.whatsapp.net`;
            }
            updateData.jid = cleanJid;
        }

        const updated = await prisma.newsSubscription.update({
            where: { id },
            data: updateData
        });

        return NextResponse.json({
            status: true,
            message: "Subscriber updated successfully",
            data: updated
        });
    } catch (error: any) {
        console.error("PUT news subscription error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}

// DELETE: Remove news subscriber
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        await prisma.newsSubscription.delete({
            where: { id }
        });

        return NextResponse.json({
            status: true,
            message: "Subscriber removed successfully"
        });
    } catch (error: any) {
        console.error("DELETE news subscription error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error.message }, { status: 500 });
    }
}

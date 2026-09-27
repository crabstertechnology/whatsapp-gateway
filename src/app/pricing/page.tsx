import Link from "next/link";
import { Bot } from "lucide-react";
import { LandingNav } from "@/components/landing/landing-nav";
import { PricingCards } from "@/components/landing/pricing";

export const metadata = {
    title: "Pricing | WhatsApp Gateway",
    description: "Choose the plan that suits your needs."
};

export const dynamic = "force-dynamic";

export default function PricingPage() {
    return (
        <div className="flex min-h-screen flex-col overflow-hidden">
            <LandingNav />

            <main className="flex-1 pt-36 pb-24">
                <section className="container px-4 md:px-6">
                    <div className="text-center mb-16 max-w-2xl mx-auto">
                        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl text-foreground mb-4">
                            Choose Your Plan
                        </h1>
                        <p className="text-muted-foreground text-lg">
                            Flexible plans with full multi-device and API automation capabilities.
                        </p>
                    </div>

                    <PricingCards ctaHref="/dashboard/billing" />

                    <p className="text-center text-sm text-muted-foreground mt-10">
                        Need larger quotas or custom requirements?{" "}
                        <Link href="/docs" className="text-primary hover:underline">
                            Contact us
                        </Link>
                        .
                    </p>
                </section>
            </main>

            <footer className="border-t border-border/50 bg-background/50 backdrop-blur-xl py-10">
                <div className="container px-4 md:px-6 max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-primary/10">
                            <Bot className="h-5 w-5 text-primary" />
                        </div>
                        <span className="font-bold text-foreground" translate="no">
                            WhatsApp Gateway
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        © {new Date().getFullYear()} WhatsApp Gateway
                    </p>
                </div>
            </footer>
        </div>
    );
}

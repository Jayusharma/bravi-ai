import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
      <main className="flex flex-col items-center gap-8 text-center px-4">
        <div className="text-6xl">📩</div>
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">
          Enquiry Management System
        </h1>
        <p className="text-xl text-muted-foreground max-w-[600px]">
          Track, manage, and convert enquiries from WhatsApp, Email, and Web
          sources — all in one place.
        </p>
        <div className="flex gap-4">
          <Link href="/login">
            <Button className="h-12 px-8 text-lg">
              Login to Dashboard
            </Button>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Version 1.0 • Enterprise Enquiry Management
        </p>
      </main>
    </div>
  );
}

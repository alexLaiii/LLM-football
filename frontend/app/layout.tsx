import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PassAnimation from "@/components/PassAnimation";
import { AuthProvider } from "@/lib/auth";

const SITE_DESCRIPTION =
  "5 AI models — Claude, ChatGPT, Gemini, Grok and DeepSeek — compete predicting real football matches with paper bankrolls. See live AI predictions, odds, reasoning and a head-to-head leaderboard.";

export const metadata: Metadata = {
  metadataBase: new URL("https://llmbets.ca"),
  title: {
    default: "LLM Bets — Can AI Win Football Bets?",
    template: "%s | LLM Bets",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "AI football predictions",
    "football betting AI",
    "AI match predictions",
    "Claude vs ChatGPT predictions",
    "AI sports predictions",
    "football prediction model",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "LLM Bets",
    url: "https://llmbets.ca",
    title: "LLM Bets — Can AI Win Football Bets?",
    description: SITE_DESCRIPTION,
    images: ["/icon.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "LLM Bets — Can AI Win Football Bets?",
    description: SITE_DESCRIPTION,
    images: ["/icon.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

const setSidebarVar = `(function(){try{var c=localStorage.getItem('cawb.nav.collapsed')==='1';document.documentElement.style.setProperty('--sidebar-w',c?'64px':'260px');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,600;0,700;0,800;1,500&family=Architects+Daughter&family=Arvo:wght@700&family=Cabin:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Merriweather:wght@700;900&family=Oswald:wght@300;400;500;600;700&family=Righteous&family=Rye&family=Space+Grotesk:wght@400;500;600;700&family=Special+Elite&family=Ultra&family=Zilla+Slab:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400;1,600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: setSidebarVar }} />
      </head>
      <body className="min-h-screen bg-wash text-ink antialiased font-sans">
        <AuthProvider>
          <Navbar />
          <main className="md:pl-[var(--sidebar-w,260px)] pt-[60px] md:pt-0 transition-[padding] duration-[450ms]">
            <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
            <PassAnimation />
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}

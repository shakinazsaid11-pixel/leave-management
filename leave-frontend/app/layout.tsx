import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { EmployeeProvider } from "@/app/context/employee-context";
import EmployeeSelector from "@/app/components/EmployeeSelector";
import NavBar from "@/app/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Leave Management",
  description: "Leave requests, balances, and approvals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <EmployeeProvider>
          <header className="sticky top-0 z-10 border-b border-navy-700 bg-navy-900/90 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3">
              <Link href="/" className="group flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure-500 text-sm font-bold text-white transition-transform duration-200 group-hover:scale-105">
                  LM
                </span>
                <span className="text-lg font-bold tracking-wide text-white transition-colors group-hover:text-azure-300">
                  LEAVE MANAGEMENT
                </span>
              </Link>
              <div className="flex flex-wrap items-center gap-4">
                <NavBar />
                <EmployeeSelector />
              </div>
            </div>
          </header>
          <main className="flex-1 px-4 py-10">
            <div className="mx-auto w-full max-w-4xl rounded-2xl border border-navy-700 bg-navy-800/80 p-8 text-slate-100 shadow-xl shadow-black/30">
              {children}
            </div>
          </main>
        </EmployeeProvider>
      </body>
    </html>
  );
}
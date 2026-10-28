import { requireTenant } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "../../contacts/contact-form";

export const metadata = { title: "Add client" };

export default async function NewClient({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  await requireTenant();
  const { return_to } = await searchParams;
  return <div className="max-w-2xl"><PageHeader title="Add client" /><ContactForm kind="client" returnTo={return_to} /></div>;
}

import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "../../contacts/contact-form";

export default async function NewSupplier() {
  await requirePageRole("manager");
  return <div className="max-w-2xl"><PageHeader title="Add supplier" /><ContactForm kind="supplier" /></div>;
}

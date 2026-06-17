// template-fields.ts — the fixed SYSTEM fields offered in the "Insert Field" dropdown.
//
// FRONTEND MIRROR of the backend resolver registry (template-variables.registry.ts),
// which lands with Step 4 (send-path auto-fill). Until a `GET /templates/variables/system`
// endpoint exists, these labels live here so the create/edit form can offer them.
//
// Keep labels in sync with the backend registry. Custom variables are NOT listed here —
// they come from the live `/templates/variables/suggest` endpoint (the TemplateVariable table).

export interface SystemFieldDef {
    /** Label inserted into the body as `[Label]`. */
    label: string;
    /** Stable source key (matches the backend registry's `source`). */
    source: string;
    /** Short hint shown in the dropdown. */
    hint: string;
}

export const SYSTEM_FIELDS: SystemFieldDef[] = [
    { label: 'Customer Name', source: 'contact.displayName', hint: "Contact's display name" },
    { label: 'Customer Phone', source: 'contact.phone', hint: "Contact's WhatsApp number" },
    { label: 'Customer Email', source: 'contact.email', hint: "Contact's email address" },
    { label: 'Product / Service', source: 'enquiry.intent', hint: 'Enquiry intent' },
    { label: 'Agent Name', source: 'user.displayName', hint: 'The sending agent' },
    { label: 'Business Name', source: 'config.business_name', hint: 'From system settings' },
    { label: 'Business Phone', source: 'config.business_phone', hint: 'From system settings' },
];

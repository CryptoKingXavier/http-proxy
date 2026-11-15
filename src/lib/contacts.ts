export type Contact = {
	surname: string;
	email: string;
};

export type ContactQuery = {
	match?: string | undefined;
	limit?: number | undefined;
	select?: string[] | undefined;
};

const contacts: Contact[] = [
	{ surname: "Lovelace", email: "ada@example.com" },
	{ surname: "Hopper", email: "grace@example.com" },
	{ surname: "Turing", email: "alan@computing.example" },
	{ surname: "Hamilton", email: "margaret@software.example" },
];

export function runQuery(query: ContactQuery): Partial<Contact>[] {
	const match = query.match?.toLowerCase();
	const selectedFields = query.select?.flatMap((field) =>
		String(field).split(/[.,]/),
	);
	const fields = selectedFields?.filter(
		(field): field is keyof Contact => field === "surname" || field === "email",
	);

	let results = contacts.filter(
		(contact) =>
			match === undefined ||
			Object.values(contact).some((value) =>
				value.toLowerCase().includes(match),
			),
	);

	if (typeof query.limit === "number" && Number.isFinite(query.limit)) {
		results = results.slice(0, Math.max(0, Math.floor(query.limit)));
	}

	return results.map((contact) => {
		if (!fields) return { ...contact };

		const selected: Partial<Contact> = {};
		for (const field of fields) selected[field] = contact[field];
		return selected;
	});
}

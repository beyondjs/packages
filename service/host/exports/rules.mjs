/**
 * What the archive of a package always leaves out, whatever its manifest and its ignore files say:
 *
 * - `internal`: `node_modules`, `.beyond` and `.git` at any depth, compared without regard to case: dependencies,
 *   the state of the development service (its exports included) and the internals of a repository.
 * - `secret`: credentials, keys, certificates, Terraform state, local databases and the directories of editors and
 *   tools, compared without regard to case: the directories `.ssh`, `.aws`, `.azure`, `.gnupg`, `.idea` and `.vscode`
 *   whole; files named `.env` and `.env.*` (but `.env.example`, which documents the variables without values),
 *   `.envrc`, `.npmrc`, `.yarnrc` and `.yarnrc.*`, `.pypirc`, `.netrc`, `.pgpass`, `.htpasswd`, `.s3cfg`, `.boto`,
 *   `.dockercfg`, `.git-credentials`, `credentials.json`, `service-account*.json`,
 *   `application_default_credentials.json`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `*.pem`, `*.key`, `*.p8`, `*.p12`,
 *   `*.pfx`, `*.jks`, `*.keystore`, `*.ppk`, `*.crt`, `*.cer`, `*.der`, `*.csr`, `*.kdbx`, `*.gpg`, `*.tfstate` and
 *   `*.tfstate.*`, `*.sqlite`, `*.sqlite3`, `*.db`; and `config.json` in a `.docker` directory and `config` in a `.kube`
 *   directory.
 *
 * Symbolic links and the directories of other workspace packages are left out by the archive itself, and what a
 * registry publication would not hold by `Publication`. An export lists what it left out by reason, never content.
 */
export class Rules {
	static INTERNAL = Object.freeze(new Set(['node_modules', '.beyond', '.git']));
	static VAULTS = Object.freeze(new Set(['.ssh', '.aws', '.azure', '.gnupg', '.idea', '.vscode']));
	static SECRET = /^(\.env|\.env\..+|\.envrc|\.npmrc|\.yarnrc|\.yarnrc\..+|\.pypirc|\.netrc|\.pgpass|\.htpasswd|\.s3cfg|\.boto|\.dockercfg|\.git-credentials|credentials\.json|service-account.*\.json|application_default_credentials\.json|id_rsa.*|id_ed25519.*|id_ecdsa.*|.+\.(pem|key|p8|p12|pfx|jks|keystore|ppk|crt|cer|der|csr|kdbx|gpg|sqlite|sqlite3|db)|.+\.tfstate(\..+)?)$/i;
	static KEPT = /^\.env\.example$/i;
	static NESTED = Object.freeze({ '.docker': new Set(['config.json']), '.kube': new Set(['config']) });

	/**
	 * Why a directory is always left out: `internal`, `secret`, or undefined when it may be archived
	 *
	 * @param {string} name
	 * @returns {'internal' | 'secret' | undefined}
	 */
	static directory(name) {
		const lower = name.toLowerCase();
		if (Rules.INTERNAL.has(lower)) return 'internal';
		if (Rules.VAULTS.has(lower)) return 'secret';
	}

	/**
	 * Whether a file is a secret
	 *
	 * @param {string} name
	 * @param {string} parent The name of the directory it is in
	 */
	static secret(name, parent = '') {
		if (Rules.KEPT.test(name)) return false;
		return Rules.SECRET.test(name) || !!Rules.NESTED[parent.toLowerCase()]?.has(name.toLowerCase());
	}

	/**
	 * Whether a path relative to the root of the workspace goes through a directory no package lives in
	 *
	 * @param {string[]} segments
	 */
	static internal(segments) {
		return segments.some(segment => Rules.INTERNAL.has(segment.toLowerCase()));
	}
}

import { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import { Response, ErrorManager } from '@beyond-js/response/main';

export /*bundle*/ class ProvidersResponse<DATA> extends Response<DATA, ProvidersErrorManager> {
	constructor(params: { error?: ErrorManager; data?: DATA }) {
		const error: ProvidersErrorManager = (() => {
			const { error } = params;
			if (!error) return;

			return (<ProvidersErrorManager>error).is === ProvidersErrorManager.is
				? <ProvidersErrorManager>error
				: new ProvidersErrorManager(error.code, error.text);
		})();

		super({ data: params.data, error });
	}
}

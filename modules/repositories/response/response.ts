import { RepositoriesErrorManager } from '@beyond-js/packages/repositories/errors';
import { Response, ErrorManager } from '@beyond-js/response/main';

export /*bundle*/ class RepositoriesResponse<DATA> extends Response<DATA, RepositoriesErrorManager> {
	constructor(params: { error?: ErrorManager; data?: DATA }) {
		const error: RepositoriesErrorManager = (() => {
			const { error } = params;
			if (!error) return;

			return (<RepositoriesErrorManager>error).is === RepositoriesErrorManager.is
				? <RepositoriesErrorManager>error
				: new RepositoriesErrorManager(error.code, error.text);
		})();

		super({ data: params.data, error });
	}
}

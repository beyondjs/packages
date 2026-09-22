import * as React from 'react';

export function View({ attributes }: { attributes: Map<string, string> }) {
	return <p className="card react">{attributes.get('label')}</p>;
}

/**
 * The entry point of the application: importing each widget module registers its element, and the page
 * composes the elements as HTML. Two widgets belong to `@fixture/ui`, which publishes a shared stylesheet; the
 * third belongs to `@fixture/other`, which publishes none.
 */
import '@fixture/ui/first';
import '@fixture/ui/second';
import '@fixture/other/third';

document.body.append(document.createElement('ui-first'), document.createElement('ui-second'), document.createElement('other-third'));

/**
 * MemberPicker — searchable member assignment input
 *
 * Vervangt een gewone <select> door een input + datalist met live filter.
 * Klein vanilla-JS scriptje koppelt de zichtbare input aan een hidden field
 * (de echte form-value) en bewaakt dat enkel geldige IDs verzonden worden.
 *
 * Usage:
 *   <MemberPicker name="verantwoordelijke_id" users={users} selectedId={123} />
 *
 * Props:
 *   - name: form field name (gebruikt voor hidden input + form submit)
 *   - users: array met { id, voornaam, achternaam, stemgroep? }
 *   - selectedId?: huidig gekozen user id
 *   - placeholder?: zoekplaceholder
 *   - inputId?: optioneel id voor edit-modal koppeling
 */

interface User {
  id: number
  voornaam?: string
  achternaam?: string
  stemgroep?: string
}

interface MemberPickerProps {
  name: string
  users: User[]
  selectedId?: number | null
  placeholder?: string
  inputId?: string
  required?: boolean
}

export function MemberPicker(props: MemberPickerProps) {
  const { name, users, selectedId, placeholder = 'Zoek naar lid...', inputId, required } = props

  // Unieke id-suffix om meerdere instanties op één pagina te ondersteunen
  const uid = inputId || `mp-${name}-${Math.random().toString(36).slice(2, 8)}`
  const hiddenId = `${uid}-hidden`
  const listId   = `${uid}-list`

  const selectedUser = selectedId ? users.find(u => u.id === selectedId) : null
  const initialText = selectedUser
    ? `${selectedUser.voornaam || ''} ${selectedUser.achternaam || ''}`.trim()
    : ''

  return (
    <div class="member-picker relative" data-member-picker={uid}>
      <input
        type="text"
        id={uid}
        list={listId}
        autocomplete="off"
        placeholder={placeholder}
        value={initialText}
        class="w-full border-gray-300 rounded-lg shadow-sm p-3 border focus:ring-animato-primary focus:border-animato-primary"
      />
      <input
        type="hidden"
        id={hiddenId}
        name={name}
        value={selectedId ? String(selectedId) : ''}
        required={required}
      />
      <datalist id={listId}>
        {users.map(u => {
          const naam = `${u.voornaam || ''} ${u.achternaam || ''}`.trim()
          const label = u.stemgroep ? `${naam} (${u.stemgroep})` : naam
          // data-id koppelt label terug naar user id
          return <option value={label} data-id={u.id}></option>
        })}
      </datalist>
    </div>
  )
}

/**
 * Renders het centrale init-script. Plak dit één keer per pagina
 * (bv. onderaan de container die member-pickers bevat).
 *
 * Het script:
 *  - mapt elke option-label → user-id via een lookup
 *  - synct hidden input bij typen / selecteren
 *  - wist hidden input als de tekst niet matcht (voorkomt valse submits)
 *  - voorziet een globale window.__setMemberPicker(uid, userId) helper voor
 *    edit-modals die programmatisch een waarde moeten zetten
 */
export function MemberPickerScript() {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
(function() {
  if (window.__memberPickerInit) return;
  window.__memberPickerInit = true;

  function buildLookup(picker) {
    var listId = picker.querySelector('input[list]').getAttribute('list');
    var list = document.getElementById(listId);
    var map = {};
    if (!list) return map;
    Array.prototype.forEach.call(list.querySelectorAll('option'), function(opt) {
      map[opt.value.toLowerCase()] = opt.getAttribute('data-id');
    });
    return map;
  }

  function initPicker(picker) {
    if (picker.__inited) return;
    picker.__inited = true;
    var input  = picker.querySelector('input[type="text"]');
    var hidden = picker.querySelector('input[type="hidden"]');
    if (!input || !hidden) return;
    var lookup = buildLookup(picker);

    function sync() {
      var v = (input.value || '').trim().toLowerCase();
      if (!v) { hidden.value = ''; return; }
      if (lookup[v]) {
        hidden.value = lookup[v];
        input.classList.remove('border-red-300');
        input.classList.add('border-gray-300');
      } else {
        hidden.value = '';
        // visueel hint dat de tekst (nog) geen match is
        input.classList.add('border-red-300');
        input.classList.remove('border-gray-300');
      }
    }

    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('blur', sync);

    // Initial state
    sync();
    // herstel grijze rand als startwaarde leeg is
    if (!input.value) { input.classList.remove('border-red-300'); input.classList.add('border-gray-300'); }
  }

  function initAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-member-picker]'), initPicker);
  }

  // Globale helper: zet picker programmatisch op een user-id
  window.__setMemberPicker = function(uid, userId) {
    var picker = document.querySelector('[data-member-picker="' + uid + '"]');
    if (!picker) return false;
    var input  = picker.querySelector('input[type="text"]');
    var hidden = picker.querySelector('input[type="hidden"]');
    if (!userId) {
      input.value = '';
      hidden.value = '';
      return true;
    }
    // zoek user label
    var listId = input.getAttribute('list');
    var list = document.getElementById(listId);
    if (list) {
      var match = Array.prototype.find.call(list.querySelectorAll('option'), function(opt) {
        return String(opt.getAttribute('data-id')) === String(userId);
      });
      if (match) {
        input.value = match.value;
        hidden.value = userId;
        input.classList.remove('border-red-300');
        input.classList.add('border-gray-300');
        return true;
      }
    }
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
  // Re-init wanneer een modal of fragment dynamisch wordt geopend
  document.addEventListener('member-picker:refresh', initAll);
})();
` }} />
  )
}

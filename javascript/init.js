(function(NAME) {

    const name = NAME.toLowerCase().replaceAll(/\s/g, '');
    
    let _r = 0;
    function to_gradio(v) {
        // force call `change` event on gradio
        return [v.toString(), (_r++).toString()];
    }
    
    function js2py(type, gradio_field, value) {
        // set `value` to gradio's field
        // (1) Click gradio's button.
        // (2) Gradio will fire js callback to retrieve value to be set.
        // (3) Gradio will fire another js callback to notify the process has been completed.
        return new Promise(resolve => {
            const callback_name = `${name}-${type}-${gradio_field}`;
            
            // (2)
            globalThis[callback_name] = () => {
                
                delete globalThis[callback_name];
                
                // (3)
                const callback_after = callback_name + '_after';
                globalThis[callback_after] = () => {
                    delete globalThis[callback_after];
                    resolve();
                };
                
                return to_gradio(value);
            };
            
            // (1)
            gradioApp().querySelector(`#${callback_name}_set`).click();
        });
    }

    function py2js(type, pyname, ...args) {
        // call python's function
        // (1) Set args to gradio's field
        // (2) Click gradio's button
        // (3) JS callback will be kicked with return value from gradio
        
        // (1)
        return (args.length == 0 ? Promise.resolve() : js2py(type, pyname + '_args', JSON.stringify(args)))
        .then(() => {
            return new Promise(resolve => {
                const callback_name = `${name}-${type}-${pyname}`;
                // (3)
                globalThis[callback_name] = value => {
                    delete globalThis[callback_name];
                    resolve(value);
                }
                // (2)
                gradioApp().querySelector(`#${callback_name}_get`).click();
            });
        });
    }

    function id(mode, s) {
        const v = `${name}-${mode}`;
        return s === undefined ? v : `${v}-${s}`;
    }

    function log(...args) {
        console.log(...args);
    }

    if (!globalThis[name]) {
        globalThis[name] = {};
    }

    const obj = globalThis[name];
    obj.id = id;
    obj.log = log;
    obj.js2py = js2py;
    obj.py2js = py2js;
    obj.init = true;

    console.log(`[${NAME}] initialized`)
    document.dispatchEvent(new CustomEvent(`${name}_init`, { detail: obj }));

})('TimeMachine');

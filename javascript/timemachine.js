(function (NAME) {
    
    const name = NAME.toLowerCase().replaceAll(/\s/g, '');
    
    if (globalThis[name] && globalThis[name].init) {
        init(name, globalThis[name]);
    } else {
        document.addEventListener(`${name}_init`, e => init(name, e.detail), { once: true });
    }
    
    async function init(name, lib) {
        await load_modules(lib);
        await main(name, lib);
    }

    function load_modules(lib) {
        return new Promise(resolve => {
            onUiUpdate(() => {

                if (lib.module_loaded) {
                    return;
                }
                
                const app = gradioApp();
                if (!app || app === document) {
                    return;
                }

                const jscont = app.querySelector('#' + lib.id('js_modules'));
                if (!jscont) {
                    return;
                }

                const [base_path, ...scripts] = jscont.textContent.trim().split('\n').map(x => x.trim());
                const mod_path = `/file=${base_path}/javascript/modules`;
                jscont.textContent = '';

                const df = document.createDocumentFragment();
                for (let src of scripts) {
                    const script = document.createElement('script');
                    script.async = true;
                    script.type = 'module';
                    script.src = `file=${src}`;
                    df.appendChild(script);
                }

                app.appendChild(df);
                
                function import_(s) {
                    return import(`${mod_path}/${s}`);
                }
                
                lib.import = import_;
                lib.module_loaded = true;
                resolve();
            });
        });
    }

    async function main(name, lib) {
        await lib.import('chart.umd.js');
        main2(name, lib, 'txt2img');
        main2(name, lib, 'img2img');
    }

    function main2(name, lib, mode) {
        const id = s => lib.id(mode, s);

        const enabled = gradioApp().querySelector(`#${id('enabled')} input[type=checkbox]`);
        const generate_button = gradioApp().querySelector(`#${mode}_generate`);
        const step_ele = gradioApp().querySelector(`#${mode}_steps input[type=number]`);
        
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        
        const data = createInitialData();
        const opt = createChartOption();
        const plugins = createPlugins(canvas, step_ele);
        
        const chart = new Chart(canvas.getContext('2d'), {
            type: 'scatter',
            data: data,
            options: opt,
            plugins: plugins,
        });

        gradioApp().querySelector('#' + id('container')).appendChild(canvas);
        updateSteps(chart, +step_ele.value);
        
        step_ele.addEventListener('input', () => updateSteps(chart, +step_ele.value));
        
        let force = false;
        gradioApp().addEventListener('click', async e => {
            if (e.target !== generate_button) return;
            
            if (!enabled.checked) return;
            
            if (force) {
                force = false;
                return;
            }
            
            // hook `generate` button to add canvas data
            e.preventDefault();
            e.stopPropagation();
            
            await lib.js2py(mode, 'tm', JSON.stringify(chart.data.datasets[0].data));
            force = true;
            generate_button.click();
        }, true);
    }

    function createInitialData() {
        const datasets = {
            datasets: [{
                type: 'line',
                showLine: true,
                lineTension: 0,
                backgroundColor: 'rgba(255, 140, 0, 0.6)',
                borderColor: 'rgba(255, 140, 0, 0.6)',
                borderWidth: 2,
                borderCapStyle: 'round',
                borderDash: [],
                borderDashOffset: 0.0,
                borderJoinStyle: 'round',
                pointBorderColor: 'rgba(255, 140, 0, 0.6)',
                pointBackgroundColor: 'rgba(255, 140, 0, 0.6)',
                pointBorderWidth: 1,
                pointHoverBackgroundColor: 'rgba(255, 140, 0, 0.6)',
                pointHoverBorderColor: 'rgba(255, 140, 0, 0.6)',
                pointHoverBorderWidth: 10,
                pointRadius: 5,
                pointHitRadius: 10,
                fill: false,
                data: [],
            }]
        };
        return datasets;
    }
    
    function createChartOption() {
        const opt = {
            responsive: false,
            events: ['mouseup', 'mousedown', 'mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
            chartArea: { backgroundColor: 'rgba(255, 255, 255, 1)' },
            scales: {
                x: { type: 'linear', display: true, title: { display: true, text: 'timesteps' }, ticks: { major: { enabled: true } }, min: 0, max: 100, stepSize: 10, },
                y: { type: 'linear', display: true, title: { display: true, text: 'actual timesteps' }, ticks: { major: { enabled: true } }, min: 0, max: 100, stepSize: 10, },
            },
            chartArea: {
                backgroundColor: 'rgba(255, 255, 255, 1)',
            },
            animation: {
                duration: 100
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function (ctxs) {
                            return ctxs.map(ctx => `${ctx.parsed.x} → ${ctx.parsed.y}`);
                        },
                        label: function () { return ''; },
                    }
                },
            },
        };
        return opt;
    }

    function createPlugins(canvas, step_ele) {
        const plugins = [{
            id: 'dragpoint',
            beforeEvent(chart, args, opt) {
                if (args.event.type === 'mousedown') {
                    const button = args.event.native.button;
                    switch (button) {
                    case 0:
                        this.startDrag(chart, args);
                        break;
                    case 2:
                        this.removePoint(chart, args);
                        break;
                    }
                    return;
                }

                if (args.event.type === 'mouseup' || args.event.type === 'mouseout') {
                    if (this.dragctx.item) this.endDrag(chart, args);
                    return;
                }

                if (args.event.type === 'mousemove') {
                    if (this.dragctx.item) this.onDrag(chart, args);
                    return;
                }
            },

            dragctx: { item: null, x: 0, y: 0, index: -1, max_steps: () => Math.max(1, +step_ele.value) },
            lastRemoved: false,
            startDrag(chart, args) {
                const item = this.getItem(chart, args);
                if (item) {
                    // start drag
                    this.dragctx.item = item;
                } else {
                    // add point if it does not already exist
                    this.addPoint(chart, args);
                }
            },
            onDrag(chart, args) {
                const y = this.getY(chart, args);
                const { datasetIndex, index } = this.dragctx.item;
                const item = chart.data.datasets[datasetIndex].data[index];
                if (item.y === y) {
                    return;
                }
                item.y = y;
                chart.update();
            },
            endDrag(chart, args) {
                this.dragctx.item = null;
            },

            addPoint(chart, args) {
                const x = this.getX(chart, args);
                const y = this.getY(chart, args);
                const found = chart.data.datasets[0].data.find(v => v.x == x);
                if (found) {
                    if (found.y != y) {
                        found.y = y;
                        chart.update();
                    }
                } else {
                    this.addItem(chart, { x, y });
                }
            },
            removePoint(chart, args) {
                const item_ = this.getItem(chart, args);
                if (item_) {
                    const { datasetIndex, index } = item_;
                    const item = chart.data.datasets[datasetIndex].data[index];
                    if (1 < item.x && item.x < this.dragctx.max_steps()) {
                        this.lastRemoved = true;
                        chart.data.datasets[datasetIndex].data.splice(index, 1);
                        chart.update();
                    }
                }
            },

            getX(chart, args) {
                const xx = chart.scales.x.getValueForPixel(args.event.native.clientX - chart.canvas.getBoundingClientRect().left);
                const x = Math.max(1, Math.min(Math.round(xx), this.dragctx.max_steps()));
                return x;
            },
            getY(chart, args) {
                const yy = chart.scales.y.getValueForPixel(args.event.native.clientY - chart.canvas.getBoundingClientRect().top);
                const y = Math.max(1, Math.min(Math.round(yy), this.dragctx.max_steps()));
                return y;
            },
            getItem(chart, args) {
                const items = chart.getElementsAtEventForMode(args.event, 'nearest', { intersect: true }, false)
                return items.length === 0 ? null : items[0];
            },

            addItem(chart, xy, donotupdate) {
                chart.data.datasets[0].data.push(xy);
                chart.data.datasets[0].data.sort((a, b) => a.x - b.x);
                if (!donotupdate) {
                    chart.update();
                }
            },
        }];
        
        canvas.addEventListener('contextmenu', e => {
            if (plugins[0].lastRemoved) {
                e.preventDefault();
                plugins[0].lastRemoved = false;
            }
        }, true);
        
        return plugins;
    }

    function updateSteps(chart, max_steps) {
        max_steps = Math.max(2, max_steps);
        
        // update scales
        const scales = chart.options.scales;
        scales.x.max = max_steps + 1;
        scales.y.max = max_steps + 1;

        // update data
        const data = chart.data.datasets[0].data;
        // 1. trimming
        //   1 <= x <= max_steps
        //   1 <= y <= max_steps
        const new_data = [];
        for (let item of data) {
            let { x, y } = item;
            if (1 <= x && x <= max_steps) {
                y = Math.min(y, max_steps);
                new_data.push({ x, y });
            }
        }

        // 2. put data for x=1 and x=max_steps
        const first = new_data.find(cur => cur.x == 1);
        const last = new_data.find(cur => cur.x == max_steps);
        if (!first) {
            new_data.unshift({ x: 1, y: 1 });
        }
        if (!last) {
            new_data.push({ x: max_steps, y: max_steps });
        }

        chart.data.datasets[0].data = new_data;
        
        chart.update();
    }

})('TimeMachine');

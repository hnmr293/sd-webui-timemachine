import os
import json
import math
from typing import Union, List, Callable, Optional

import torch
import gradio as gr

from modules.processing import StableDiffusionProcessing
from modules import scripts
from modules.sd_samplers_kdiffusion import KDiffusionSampler
from modules import extensions

from scripts.timemachinelib import sampler
from scripts.timemachinelib.xyz import init_xyz

NAME = 'TimeMachine'

class Script(scripts.Script):
    
    def __init__(self) -> None:
        self.last_sampler_name: Optional[str] = None
    
    def title(self):
        return NAME
    
    def show(self, is_img2img):
        return scripts.AlwaysVisible
    
    def ui(self, is_img2img):
        # load js modules
        ext = get_self_extension()
        if ext is not None and not is_img2img: # only once, in txt2img
            js_ = [f'{x.path}?{os.path.getmtime(x.path)}' for x in ext.list_files('javascript/modules', '.js')]
            js_.insert(0, ext.path)
            gr.HTML(value='\n'.join(js_), elem_id=f'{NAME.lower()}-js_modules')
        
        mode = 'img2img' if is_img2img else 'txt2img'
        id = lambda x: f'{NAME.lower()}-{mode}-{x}'
        js = lambda s: f'globalThis["{id(s)}"]'
        
        with gr.Accordion(NAME, open=False, elem_id=id('accordion')):
            enabled = gr.Checkbox(label='Enabled', value=False, elem_id=id('enabled'))
            gr.HTML(elem_id=id('container'))
            
            with gr.Group(visible=False):
                sink = gr.HTML(value='') # to suppress error in javascript
                tm = js2py('tm', id, js, sink)
        
        return [enabled, tm]
    
    def process_batch(
        self,
        p: StableDiffusionProcessing,
        enabled: bool,
        tm: str,
        **kwargs
    ):
        if not enabled:
            #KDiffusionSampler.get_sigmas = self.org_get_sigmas
            return
        
        vs = { v['x']: v['y'] for v in json.loads(tm) }
        assert 2 <= len(vs)
        assert 1 in vs
        assert p.steps in vs
        
        def each_slice(xs, n):
            for i in range(len(xs) - n + 1):
                yield xs[i:i+n]
        
        steps: List[int] = []
        for min_step, max_step in each_slice(sorted(vs.keys()), 2):
            min_step_actual = vs[min_step]
            max_step_actual = vs[max_step]
            for step in range(min_step, max_step):
                # lerp (min_step, min_step_actual) -> (max_step, max_step_actual)
                step_actual = min_step_actual + (max_step_actual - min_step_actual) / (max_step - min_step) * (step - min_step)
                steps.append(math.floor(step_actual))
        steps.append(vs[p.steps])
        
        assert len(steps) == p.steps, f'len(steps)={len(steps)}, p.steps={p.steps}'
        
        p.steps = max(steps)
        
        s = sampler.get_sampler('DPM++ 2M Karras TM')
        assert s is not None, 'DPM++ 2M Karras TM is not found.'
        
        s.func.steps = steps # type: ignore
        
        if p.sampler_name != 'DPM++ 2M Karras TM':
            self.last_sampler_name = p.sampler_name
        p.sampler_name = 'DPM++ 2M Karras TM'
        
        p.extra_generation_params.update({
            f'{NAME} Enabled': enabled,
            f'{NAME} Steps': steps,
        })
    
    def postprocess_batch(self, p, *args, **kwargs):
        if self.last_sampler_name is not None:
            p.sampler_name = self.last_sampler_name


def get_self_extension():
    for ext in extensions.active():
        if ext.path in __file__:
            return ext


def js2py(
    name: str,
    id: Callable[[str], str],
    js: Callable[[str], str],
    sink: gr.components.IOComponent,
):
    v_set = gr.Button(elem_id=id(f'{name}_set'))
    v = gr.Textbox(elem_id=id(name))
    v_sink = gr.Textbox()
    v_set.click(fn=None, _js=js(name), outputs=[v, v_sink])
    v_sink.change(fn=None, _js=js(f'{name}_after'), outputs=[sink])    
    return v


init_xyz(Script, NAME)

# register new sampler
sampler.add_sampler('DPM++ 2M Karras TM', 'sample_dpmpp_2m_tm', 'sample_dpmpp_2m', sampler.DPM_PP_2M_TM(), ['k_dpmpp_2m_tm'], {'scheduler': 'karras'})
sampler.update_samplers()


# hook Sampler textbox creation
from modules import ui
ui.create_sampler_and_steps_selection = sampler.hook(ui.create_sampler_and_steps_selection)

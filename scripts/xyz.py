import os
from typing import Union, List, Callable

from modules import scripts
from modules.processing import StableDiffusionProcessing, StableDiffusionProcessingTxt2Img, StableDiffusionProcessingImg2Img


def __set_value(p: StableDiffusionProcessing, script: type, index: int, value):
    args = list(p.script_args)
    
    if isinstance(p, StableDiffusionProcessingTxt2Img):
        all_scripts = scripts.scripts_txt2img.scripts
    else:
        all_scripts = scripts.scripts_img2img.scripts
    
    froms = [x.args_from for x in all_scripts if isinstance(x, script)]
    for idx in froms:
        assert idx is not None
        args[idx + index] = value
    
    p.script_args = type(p.script_args)(args)


def to_bool(v: str):
    if len(v) == 0: return False
    v = v.lower()
    if 'true' in v: return True
    if 'false' in v: return False
    
    try:
        w = int(v)
        return bool(w)
    except:
        acceptable = ['True', 'False', '1', '0']
        s = ', '.join([f'`{v}`' for v in acceptable])
        raise ValueError(f'value must be one of {s}.')

__init = False

def init_xyz(script: type):
    global __init
    
    if __init:
        return
    
    for data in scripts.scripts_data:
        name = os.path.basename(data.path)
        if name == 'xy_grid.py' or name == 'xyz_grid.py':
            AxisOption = data.module.AxisOption
            
            def define(param: str, index: int, type: Callable, choices: List[str] = []):
                def fn(p, x, xs):
                    __set_value(p, script, index, x)
                if len(choices) == 0:
                    data.module.axis_options.append(AxisOption(f'[TimeMachine] {param}', type, fn))
                else:
                    data.module.axis_options.append(AxisOption(f'[TimeMachine] {param}', type, fn, choices=lambda: choices))
            
            define('Enabled', 0, to_bool, choices=['false', 'true'])
            define('Steps', 1, str)
            
    __init = True

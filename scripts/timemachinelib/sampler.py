from __future__ import annotations

import sys
import functools
from collections import namedtuple
from typing import Optional
import torch
from torch import nn
import tqdm

import k_diffusion.sampling # type: ignore
from modules import shared
from modules import sd_samplers
import modules.sd_samplers_kdiffusion as K

SamplerData2 = namedtuple('SamplerData2', ['name', 'constructor', 'aliases', 'options', 'func'])

class DPM_PP_2M_TM:
    
    def __init__(self):
        self.steps: Optional[list[int]]  = None
    
    @torch.no_grad()
    def __call__(self, model, x, sigmas, extra_args=None, callback=None, disable=None):
        """DPM-Solver++(2M)."""
        extra_args = {} if extra_args is None else extra_args
        s_in = x.new_ones([x.shape[0]])
        sigma_fn = lambda t: t.neg().exp()
        t_fn = lambda sigma: sigma.log().neg()
        old_denoised = None

        for i in tqdm.tqdm(self.steps, disable=disable):
            i -= 1
            
            denoised = model(x, sigmas[i] * s_in, **extra_args)
            if callback is not None:
                callback({'x': x, 'i': i, 'sigma': sigmas[i], 'sigma_hat': sigmas[i], 'denoised': denoised})
            t, t_next = t_fn(sigmas[i]), t_fn(sigmas[i + 1])
            h = t_next - t
            if old_denoised is None or sigmas[i + 1] == 0:
                x = (sigma_fn(t_next) / sigma_fn(t)) * x - (-h).expm1() * denoised
            else:
                h_last = t - t_fn(sigmas[i - 1])
                r = h_last / h
                denoised_d = (1 + 1 / (2 * r)) * denoised - (1 / (2 * r)) * old_denoised
                x = (sigma_fn(t_next) / sigma_fn(t)) * x - (-h).expm1() * denoised_d
            old_denoised = denoised
        return x


class KDiffusionSamplerLocal(K.KDiffusionSampler):
    
    def __init__(
        self,
        funcname: str,
        original_funcname: str,
        func,
        sd_model: nn.Module
    ):
        # here we do not call super().__init__() 
        # because target function is not in k_diffusion.sampling
        
        denoiser = k_diffusion.external.CompVisVDenoiser if sd_model.parameterization == "v" else k_diffusion.external.CompVisDenoiser

        self.model_wrap = denoiser(sd_model, quantize=shared.opts.enable_quantization)
        self.funcname = funcname
        self.func = func
        self.extra_params = K.sampler_extra_params.get(original_funcname, [])
        self.model_wrap_cfg = K.CFGDenoiser(self.model_wrap)
        self.sampler_noises = None
        self.stop_at = None
        self.eta = None
        self.config = None
        self.last_latent = None

        self.conditioning_key = sd_model.model.conditioning_key # type: ignore


def add_sampler(label: str, funcname: str, base_funcname, func, aliases, options):
    def constructor(model: nn.Module):
        return KDiffusionSamplerLocal(funcname, base_funcname, func, model)
    
    data = SamplerData2(label, constructor, aliases, options, func)
    
    if len([ x for x in sd_samplers.all_samplers if x.name == label ]) == 0:
        sd_samplers.all_samplers.append(data) # type: ignore


def get_sampler(label: str):
    for sampler in sd_samplers.all_samplers:
        if sampler.name == label:
            return sampler
    return None
    

def update_samplers():
    sd_samplers.set_samplers()
    sd_samplers.all_samplers_map = {x.name: x for x in sd_samplers.all_samplers}


def hook(fn):
    
    @functools.wraps(fn)
    def f(*args, **kwargs):
        old_samplers, mode, *rest = args
        
        if mode not in ['txt2img', 'img2img']:
            print(f'unknown mode: {mode}', file=sys.stderr)
            return fn(*args, **kwargs)
        
        update_samplers()
        
        new_samplers = (
            sd_samplers.samplers if mode == 'txt2img' else
            sd_samplers.samplers_for_img2img
        )
        
        return fn(new_samplers, mode, *rest, **kwargs)
    
    return f

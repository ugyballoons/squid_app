import yaml
import os


def init_resources():
    with open("resources.yaml") as f:
        resources = yaml.load(f, Loader=yaml.FullLoader)

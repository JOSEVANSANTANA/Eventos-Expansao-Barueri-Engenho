"""Cérebro de Operações — backend que transforma conversa de grupo em Trello."""

import warnings

# O SDK google-generativeai despeja um aviso de descontinuação de 8 linhas em toda
# importação. O terminal aqui é a interface do usuário final: silencia o ruído sem
# esconder erros de verdade. A migração está anotada no README.
warnings.filterwarnings(
    "ignore",
    message=r"(?s).*All support for the .google\.generativeai. package has ended.*",
    category=FutureWarning,
)

__version__ = "1.0.0"

__all__ = ["__version__"]

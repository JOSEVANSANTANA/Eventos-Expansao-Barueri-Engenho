document.addEventListener('DOMContentLoaded', function() {
    // Sistema de contas de usuário
    var usuarios = {
        'usuario1': {
            senha: 'senha1',
            permissoes: ['admin']
        },
        'usuario2': {
            senha: 'senha2',
            permissoes: ['editar']
        }
    };

    // Função para verificar login
    function verificarLogin(nomeUsuario, senha) {
        var usuario = usuarios[nomeUsuario];
        if (usuario && usuario.senha === senha) {
            return usuario.permissoes;
        } else {
            return false;
        }
    }

    // Login
    document.getElementById('entrar').addEventListener('click', function() {
        var nomeUsuario = document.getElementById('nome-usuario').value;
        var senha = document.getElementById('senha').value;
        var permissoes = verificarLogin(nomeUsuario, senha);
        if (permissoes) {
            // Login bem-sucedido
            document.getElementById('login').style.display = 'none';

            // Verificar permissões para exibir funcionalidades
            if (permissoes.includes('admin')) {
                // Usuário admin: pode editar e excluir
                addButton.style.display = ''; // Mostrar botão "Adicionar"
                // ... (código para habilitar edição e exclusão de horários)
            } else if (permissoes.includes('editar')) {
                // Usuário editor: pode editar
                addButton.style.display = 'none'; // Ocultar botão "Adicionar"
                // ... (código para habilitar edição de horários)
            } else {
                // Usuário sem permissão: não pode fazer nada
                addButton.style.display = 'none'; // Ocultar botão "Adicionar"
                // ... (código para desabilitar edição e exclusão de horários)
            }
        } else {
            // Login falhou
            alert('Nome de usuário ou senha inválidos.');
        }
    });

    // ID do cliente OAuth 2.0
    var clientId = 'YOUR_CLIENT_ID';

    // Escopos de acesso
    var scopes = 'https://www.googleapis.com/auth/calendar.events';

    // Inicializar o Google API Client
    gapi.load('client:auth2', function() {
        gapi.client.init({
            clientId: clientId,
            scope: scopes
        }).then(function() {
            // Autorizar o usuário
            gapi.auth2.getAuthInstance().signIn().then(function() {
                // ... (código para interagir com o Google Calendar)
            });
        });
    });

    // Calendário
    var calendarEl = document.getElementById('agenda-calendario');
    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        selectable: true,
        select: function(info) {
            var title = prompt('Nome do evento:');
            if (title) {
                var event = {
                    title: title,
                    start: info.start,
                    end: info.end
                };
                calendar.addEvent(event);

                // Lembrete
                var lembrete = new Date(info.start.getTime() - 60 * 60 * 1000);
                if (lembrete > new Date()) {
                    setTimeout(function() {
                        exibirNotificacao('Lembrete de evento', 'O evento "' + title + '" começará em 1 hora.');
                    }, lembrete.getTime() - new Date().getTime());
                }

                // Criar evento no Google Calendar
                criarEventoGoogleCalendar(title, info.start.toISOString(), info.end.toISOString());
            }
        },
        editable: true,
        eventClick: function(info) {
            var newTitle = prompt('Nome do evento:', info.event.title);
            if (newTitle) {
                info.event.setProp('title', newTitle);
            }
        }
    });
    calendar.render();

    // Função para criar um evento no Google Calendar
    function criarEventoGoogleCalendar(titulo, inicio, fim) {
        gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': {
                'summary': titulo,
                'start': {
                    'dateTime': inicio
                },
                'end': {
                    'dateTime': fim
                }
            }
        }).then(function(response) {
            console.log('Evento criado:', response.result);
        });
    }

    // Função para importar eventos do Google Calendar
    function importarEventosGoogleCalendar() {
        gapi.client.calendar.events.list({
            'calendarId': 'primary'
        }).then(function(response) {
            var events = response.result.items;
            // ... (código para processar os eventos e adicioná-los ao FullCalendar)
        });
    }

    // Adicionar um botão para importar eventos
    var importarEventosButton = document.createElement('button');
    importarEventosButton.textContent = 'Importar eventos do Google Calendar';
    importarEventosButton.addEventListener('click', importarEventosGoogleCalendar);
    document.getElementById('agenda').appendChild(importarEventosButton);

    // Função para exportar eventos para o Google Calendar
    function exportarEventosGoogleCalendar() {
        // ... (código para obter os eventos do FullCalendar)
        events.forEach(function(event) {
            gapi.client.calendar.events.insert({
                'calendarId': 'primary',
                'resource': {
                    'summary': event.title,
                    'start': {
                        'dateTime': event.start.toISOString()
                    },
                    'end': {
                        'dateTime': event.end.toISOString()
                    }
                }
            }).then(function(response) {
                console.log('Evento exportado:', response.result);
            });
        });
    }

    // Adicionar um botão para exportar eventos
    var exportarEventosButton = document.createElement('button');
    exportarEventosButton.textContent = 'Exportar eventos para o Google Calendar';
    exportarEventosButton.addEventListener('click', exportarEventosGoogleCalendar);
    document.getElementById('agenda').appendChild(exportarEventosButton);

    // Horários
    var horariosTable = document.querySelector('#horarios table');
    var newRow = horariosTable.insertRow();
    var cell1 = newRow.insertCell(0);
    var cell2 = newRow.insertCell(1);
    var cell3 = newRow.insertCell(2);
    var cell4 = newRow.insertCell(3);

    cell1.innerHTML = '<input type="text" placeholder="Dia">';
    cell2.innerHTML = '<input type="time">';
    cell3.innerHTML = '<input type="time">';
    cell4.innerHTML = '<input type="text" placeholder="Atividade">';

    var addButton = document.createElement('button');
    addButton.textContent = 'Adicionar';
    addButton.addEventListener('click', function() {
        var dia = cell1.querySelector('input').value;
        var inicio = cell2.querySelector('input').value;
        var fim = cell3.querySelector('input').value;
        var atividade = cell4.querySelector('input').value;

        var newRow = horariosTable.insertRow(horariosTable.rows.length - 1);
        var cell1 = newRow.insertCell(0);
        var cell2 = newRow.insertCell(1);
        var cell3 = newRow.insertCell(2);
        var cell4 = newRow.insertCell(3);

        cell1.textContent = dia;
        cell2.textContent = inicio;
        cell3.textContent = fim;
        cell4.textContent = atividade;

        // Adiciona botões de editar e excluir (apenas para usuários com permissão)
        if (permissoes.includes('admin') || permissoes.includes('editar')) {
            var editButton = document.createElement('button');
            editButton.textContent = 'Editar';
            editButton.addEventListener('click', function() {
                var row = this.parentNode.parentNode;
                var cells = row.cells;

                // Cria inputs para edição
                var inputDia = document.createElement('input');
                inputDia.type = 'text';
                inputDia.value = cells[0].textContent;
                cells[0].innerHTML = '';
                cells[0].appendChild(inputDia);

                var inputInicio = document.createElement('input');
                inputInicio.type = 'time';
                inputInicio.value = cells[1].textContent;
                cells[1].innerHTML = '';
                cells[1].appendChild(inputInicio);

                var inputFim = document.createElement('input');
                inputFim.type = 'time';
                inputFim.value = cells[2].textContent;
                cells[2].innerHTML = '';
                cells[2].appendChild(inputFim);

                var inputAtividade = document.createElement('input');
                inputAtividade.type = 'text';
                inputAtividade.value = cells[3].textContent;
                cells[3].innerHTML = '';
                cells[3].appendChild(inputAtividade);

                // Salva os novos valores
                var saveButton = document.createElement('button');
                saveButton.textContent = 'Salvar';
                saveButton.addEventListener('click', function() {
                    cells[0].textContent = inputDia.value;
                    cells[1].textContent = inputInicio.value;
                    cells[2].textContent = inputFim.value;
                    cells[3].textContent = inputAtividade.value;

                    // Remove os botões de salvar e cancelar
                    cells[3].removeChild(saveButton);
                    cells[3].removeChild(cancelButton);
                });
                cells[3].appendChild(saveButton);

                // Cancela a edição
                var cancelButton = document.createElement('button');
                cancelButton.textContent = 'Cancelar';
                cancelButton.addEventListener('click', function() {
                    cells[0].textContent = inputDia.value;
                    cells[1].textContent = inputInicio.value;
                    cells[2].textContent = inputFim.value;
                    cells[3].textContent = inputAtividade.value;

                    // Remove os botões de salvar e cancelar
                    cells[3].removeChild(saveButton);
                    cells[3].removeChild(cancelButton);
                });
                cells[3].appendChild(cancelButton);
            });
            cell4.appendChild(editButton);
        }

        if (permissoes.includes('admin')) {
            var deleteButton = document.createElement('button');
            deleteButton.textContent = 'Excluir';
            deleteButton.addEventListener('click', function() {
                var row = this.parentNode.parentNode;
                row.remove();
            });
            cell4.appendChild(deleteButton);
        }

        // Lembrete
        var lembreteData = document.getElementById('lembrete-data-horarios').value;
        var lembreteHora = document.getElementById('lembrete-hora-horarios').value;
        if (lembreteData && lembreteHora) {
            var lembrete = new Date(lembreteData + 'T' + lembreteHora);
class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        this.weatherData = new Map();
        this.isMobile = window.innerWidth < 768;
        this.viewType = this.isMobile ? 'agenda' : 'month';

        // Handle resize events for responsive behavior
        window.addEventListener('resize', () => {
            const wasMobile = this.isMobile;
            this.isMobile = window.innerWidth < 768;
            if (wasMobile !== this.isMobile) {
                this.viewType = this.isMobile ? 'agenda' : 'month';
                this.refreshCalendar();
            }
        });

        $(document).ready(() => this.initialize());
    }

    showModal(eventDetails) {
        // Format end time if not provided
        eventDetails.labelEndTime = eventDetails.labelEndTime || eventDetails.endTime;

        const modalHTML = `
            <dialog id="eventModal" class="modal">
                <div class="modal-box">
                    <h3 class="font-bold text-lg">${eventDetails.title}</h3>
                    <div class="py-4 space-y-2">
                        ${eventDetails.room ? `
                            <p class="flex items-center gap-2">
                                <i class="bi bi-geo-alt"></i>
                                <span>${eventDetails.room}</span>
                            </p>
                        ` : ''}
                        <p class="flex items-center gap-2">
                            <i class="bi bi-clock"></i>
                            <span>${moment(eventDetails.startTime).format('h:mm A')} - ${moment(eventDetails.labelEndTime).format('h:mm A')}</span>
                        </p>
                        ${eventDetails.description ? `
                            <p class="flex items-center gap-2">
                                <i class="bi bi-card-text"></i>
                                <span>${eventDetails.description}</span>
                            </p>
                        ` : ''}
                    </div>
                    <div class="modal-action">
                        <form method="dialog">
                            <button class="btn">Close</button>
                        </form>
                    </div>
                </div>
            </dialog>
        `;

        // Remove any existing modal
        $('#eventModal').remove();

        // Add and show new modal
        $('body').append(modalHTML);
        document.getElementById('eventModal').showModal();
    }

    eventClickHandler(eventId) {
        const eventDetails = this.events.find(event => event.id === eventId);
        if (eventDetails) {
            this.showModal(eventDetails);
        }
    }

    constructHTML() {
        const html = `
            <div class="calendar-container">
                <div class="calendar-header">
                    <div class="flex justify-between items-center mb-4">
                        <h4 class="calendar-month-year">
                            <span id="month" class="calendar-month"></span>
                            <span id="year" class="calendar-year"></span>
                        </h4>
                        <div class="flex items-center gap-2">
                            ${!this.isMobile ? `
                                <div class="btn-group">
                                    <button class="btn btn-sm" id="viewMonth">Month</button>
                                    <button class="btn btn-sm" id="viewAgenda">Agenda</button>
                                </div>
                            ` : ''}
                            <div class="btn-group">
                                <button id="left" class="btn btn-sm">
                                    <i class="bi bi-chevron-left"></i>
                                </button>
                                <button id="today" class="btn btn-sm">Today</button>
                                <button id="right" class="btn btn-sm">
                                    <i class="bi bi-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="calendar-body"></div>
            </div>
        `;
        $(`#${this.containerId}`).html(html);

        this.bindViewControls();
    }

    bindViewControls() {
        $('#viewMonth', `#${this.containerId}`).on('click', () => {
            this.viewType = 'month';
            this.refreshCalendar();
            $('#viewMonth').addClass('btn-active');
            $('#viewAgenda').removeClass('btn-active');
        });

        $('#viewAgenda', `#${this.containerId}`).on('click', () => {
            this.viewType = 'agenda';
            this.refreshCalendar();
            $('#viewAgenda').addClass('btn-active');
            $('#viewMonth').removeClass('btn-active');
        });

        $('#today', `#${this.containerId}`).on('click', () => {
            this.currentDate = new Date();
            this.refreshCalendar();
        });
    }

    generateMonthView(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';

        // Add day headers
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            html += `<th>${day}</th>`;
        });
        html += '</tr></thead><tbody><tr>';

        // Add empty cells for days before the first of the month
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td class="bg-base-200/50"></td>';
        }

        // Add days of the month
        for (let day = 1; day <= totalDays; day++) {
            const dayDate = moment(new Date(d.getFullYear(), d.getMonth(), day));
            const dateStr = dayDate.format('YYYY-MM-DD');
            const isToday = dayDate.isSame(moment(), 'day');
            const weather = this.weatherData.get(dateStr);

            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>';
            }

            // Filter events for this day
            const dayEvents = this.events.filter(event => {
                const eventDate = moment(event.startTime);
                return eventDate.format('YYYY-MM-DD') === dateStr;
            });

            html += `
                <td class="relative ${isToday ? 'bg-primary/5' : ''}" data-date="${dateStr}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold ${isToday ? 'text-primary' : ''}">${day}</span>
                        ${weather ? `
                            <div class="weather-info text-xs flex flex-col items-end">
                                <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                <div class="text-right">
                                    <span class="text-red-500">${weather.maxTemp}°</span>
                                    <span class="text-blue-500">${weather.minTemp}°</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="space-y-1 mt-1">
                        ${dayEvents.map(event => `
                            <div class="event-bar bg-primary/10 hover:bg-primary/20 cursor-pointer p-1 rounded text-xs" 
                                 data-eventid="${event.id}" 
                                 title="${event.title}">
                                ${moment(event.startTime).format('HH:mm')} ${event.title}
                            </div>
                        `).join('')}
                    </div>
                </td>
            `;
        }

        // Add empty cells for days after the last day of the month
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td class="bg-base-200/50"></td>';
        }

        html += '</tr></tbody></table>';
        return html;
    }

    generateAgendaView() {
        const startOfMonth = moment(this.currentDate).startOf('month');
        const endOfMonth = moment(this.currentDate).endOf('month');

        // Filter events for current month and sort by date
        const monthEvents = this.events
            .filter(event => {
                const eventDate = moment(event.startTime);
                return eventDate.isBetween(startOfMonth, endOfMonth, 'day', '[]');
            })
            .sort((a, b) => moment(a.startTime).valueOf() - moment(b.startTime).valueOf());

        if (monthEvents.length === 0) {
            return `
                <div class="text-center p-8 text-base-content/70">
                    <i class="bi bi-calendar-x text-4xl mb-2"></i>
                    <p>No events scheduled this month</p>
                </div>
            `;
        }

        // Group events by date
        const groupedEvents = monthEvents.reduce((groups, event) => {
            const dateKey = moment(event.startTime).format('YYYY-MM-DD');
            if (!groups[dateKey]) {
                groups[dateKey] = [];
            }
            groups[dateKey].push(event);
            return groups;
        }, {});

        // Generate HTML for grouped events
        let html = '<div class="space-y-4">';

        Object.entries(groupedEvents).forEach(([date, dateEvents]) => {
            const momentDate = moment(date);
            const isToday = momentDate.isSame(moment(), 'day');
            const weather = this.weatherData.get(date);

            html += `
                <div class="agenda-day ${isToday ? 'border-l-4 border-primary pl-2' : ''}">
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="font-bold text-lg">
                            ${momentDate.format('ddd, MMM D')}
                            ${isToday ? ' <span class="badge badge-primary">Today</span>' : ''}
                        </h3>
                        ${weather ? `
                            <div class="flex items-center gap-2 text-sm">
                                <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                <span class="text-red-500">${weather.maxTemp}°</span>
                                <span class="text-blue-500">${weather.minTemp}°</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="space-y-2">
                        ${dateEvents.map(event => `
                            <div class="card bg-base-100 p-3 cursor-pointer hover:shadow-md transition-shadow" 
                                 data-eventid="${event.id}"
                                 onclick="window.app.mainCalendar.eventClickHandler(${event.id})">
                                <div class="flex justify-between items-start">
                                    <div>
                                        <p class="font-medium">${event.title}</p>
                                        <p class="text-sm text-base-content/70">
                                            ${moment(event.startTime).format('h:mm A')} - 
                                            ${moment(event.endTime).format('h:mm A')}
                                        </p>
                                        ${event.room ? `
                                            <p class="text-sm text-base-content/70">
                                                <i class="bi bi-geo-alt"></i> ${event.room}
                                            </p>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        return html;
    }

    loadEvents(events) {
        this.events = events;
        this.refreshCalendar();
    }

    refreshCalendar() {
        if (this.viewType === 'agenda' || this.isMobile) {
            $('.calendar-body', `#${this.containerId}`).html(this.generateAgendaView());
        } else {
            $('.calendar-body', `#${this.containerId}`).html(this.generateMonthView(this.currentDate));

            // Bind event click handlers for month view
            $('.event-bar').on('click', (e) => {
                const eventId = $(e.currentTarget).data('eventid');
                this.eventClickHandler(eventId);
            });
        }

        this.updateMonthYear(this.currentDate);

        // Update view toggle buttons
        if (!this.isMobile) {
            $(`#viewMonth`).toggleClass('btn-active', this.viewType === 'month');
            $(`#viewAgenda`).toggleClass('btn-active', this.viewType === 'agenda');
        }
    }

    updateMonthYear(d) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        $('#month', `#${this.containerId}`).text(monthNames[d.getMonth()]);
        $('#year', `#${this.containerId}`).text(d.getFullYear());
    }

    getWMOIcon(code) {
        const weatherCodes = {
            0: { icon: 'bi-sun-fill', class: 'text-yellow-500' },
            1: { icon: 'bi-sun-fill', class: 'text-yellow-500' },
            2: { icon: 'bi-cloud-sun-fill', class: 'text-gray-500' },
            3: { icon: 'bi-cloud-fill', class: 'text-gray-500' },
            45: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },
            48: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },
            51: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            53: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            55: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },
            61: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },
            63: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },
            65: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },
            71: { icon: 'bi-snow', class: 'text-blue-200' },
            73: { icon: 'bi-snow', class: 'text-blue-200' },
            75: { icon: 'bi-snow-fill', class: 'text-blue-200' },
            95: { icon: 'bi-cloud-lightning-fill', class: 'text-yellow-600' },
            96: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' },
            99: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' }
        };

        return weatherCodes[code] || { icon: 'bi-question-circle', class: 'text-gray-500' };
    }

    async fetchWeatherData() {
        try {
            const response = await fetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
                latitude: '43.65',  // Toronto coordinates
                longitude: '-79.38',
                daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min'],
                timezone: 'America/New_York'
            }));

            const data = await response.json();

            // Map the weather data by date
            data.daily.time.forEach((date, index) => {
                this.weatherData.set(date, {
                    weatherCode: data.daily.weather_code[index],
                    maxTemp: Math.round(data.daily.temperature_2m_max[index]),
                    minTemp: Math.round(data.daily.temperature_2m_min[index])
                });
            });
        } catch (error) {
            console.error('Error fetching weather data:', error);
        }
    }

    async changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        await this.fetchWeatherData();
        this.refreshCalendar();
    }

    bindEventHandlers() {
        // Navigation handlers
        $('#left', `#${this.containerId}`).off('click').on('click', () => this.changeMonth(-1));
        $('#right', `#${this.containerId}`).off('click').on('click', () => this.changeMonth(1));

        // View type handlers
        if (!this.isMobile) {
            $('#viewMonth, #viewAgenda', `#${this.containerId}`).off('click').on('click', (e) => {
                const viewType = e.currentTarget.id.replace('view', '').toLowerCase();
                this.viewType = viewType;
                this.refreshCalendar();
            });
        }

        // Today button handler
        $('#today', `#${this.containerId}`).off('click').on('click', () => {
            this.currentDate = new Date();
            this.refreshCalendar();
        });

        // Event click handlers
        $('.event-bar, .agenda-event').off('click').on('click', (e) => {
            const eventId = $(e.currentTarget).data('eventid');
            this.eventClickHandler(eventId);
        });
    }

    async initialize() {
        await this.fetchWeatherData();
        this.constructHTML();
        this.bindEventHandlers();
        this.refreshCalendar();

        // Re-bind event handlers whenever the calendar is refreshed
        this.bindEventHandlers();

        // Handle window resize for responsive layout
        $(window).on('resize', _.debounce(() => {
            const newIsMobile = window.innerWidth < 768;
            if (this.isMobile !== newIsMobile) {
                this.isMobile = newIsMobile;
                this.viewType = this.isMobile ? 'agenda' : 'month';
                this.refreshCalendar();
            }
        }, 250));
    }
}
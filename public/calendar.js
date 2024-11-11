class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
        this.weatherData = new Map();
        $(document).ready(() => this.initialize());
    }
    // Method to create and show the modal with event details
    showModal(eventDetails) {
        // Create the modal HTML
        eventDetails.labelEndTime = eventDetails.labelEndTime || eventDetails.endTime;

        const modalHTML = `
        <div class="modal fade" id="eventModal" tabindex="-1" aria-labelledby="eventModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="eventModalLabel">${eventDetails.title}</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p><strong>Room:</strong> ${eventDetails.room}</p>
                        <p><strong>Time:</strong> ${moment(eventDetails.startTime).format('hh:mm')} - ${moment(eventDetails.labelEndTime).format('hh:mm')}</p>
                        <p><strong>Description:</strong> ${eventDetails.description}</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="bookNowButton">Book Now</button>
                    </div>
                </div>
            </div>
        </div>
        `;

        // Append the modal to the body and show it
        $('body').append(modalHTML);
        $('#eventModal').modal('show');

        // Event listener for modal close or hide to remove it
        $('#eventModal').on('hidden.bs.modal', function () {
            $('#eventModal').remove();
        });

        // Bind the "Book Now" button event here, if needed
        $('#bookNowButton').click(() => {
            alert('Book now action not implemented.');
            $('#eventModal').modal('hide'); // Hide modal after booking
        });
    }

    // Event handler function to open modal with event details
    eventClickHandler(eventId) {
        const eventDetails = this.events.find(event => event.id === eventId);
        if (eventDetails) {
            this.showModal(eventDetails);
        }
    }
    constructHTML() {
        const html = `
        <div class="calendar-header">
            <h4 class="calendar-month-year">
                <span id="month" class="calendar-month"></span>
                <span id="year" class="calendar-year"></span>
                <div class="calendar-nav" style="display: inline-block;">
                    <a id="left" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Previous Month">
                        <i class="bi bi-chevron-left"></i>
                    </a>
                    <a id="right" href="#" class="btn btn-outline-primary btn-sm" data-tip="tooltip" title="Next Month">
                        <i class="bi bi-chevron-right"></i>
                    </a>
                </div>
            </h4>
        </div>
        <div class="row">
            <div class="col-12">
                <table class="table table-bordered">
                    <!-- Calendar Table Content -->
                </table>
            </div>
        </div>
        `;
        $('#' + this.containerId).html(html);
    }

    loadEvents(events) {
        this.events = events;
        this.refreshCalendar();
    }

    refreshCalendar() {
        this.generateCalendar(this.currentDate);
    }
    getWMOIcon(code) {
        // WMO Weather interpretation codes (https://open-meteo.com/en/docs)
        const weatherCodes = {
            0: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  // Clear sky
            1: { icon: 'bi-sun-fill', class: 'text-yellow-500' },  // Mainly clear
            2: { icon: 'bi-cloud-sun-fill', class: 'text-gray-500' },  // Partly cloudy
            3: { icon: 'bi-cloud-fill', class: 'text-gray-500' },  // Overcast

            // Fog codes
            45: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  // Foggy
            48: { icon: 'bi-cloud-haze-fill', class: 'text-gray-400' },  // Depositing rime fog

            // Drizzle codes
            51: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  // Light drizzle
            53: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  // Moderate drizzle
            55: { icon: 'bi-cloud-drizzle-fill', class: 'text-blue-400' },  // Dense drizzle

            // Freezing Drizzle codes
            56: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  // Light freezing drizzle
            57: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  // Dense freezing drizzle

            // Rain codes
            61: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  // Slight rain
            63: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  // Moderate rain
            65: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  // Heavy rain

            // Freezing Rain codes
            66: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  // Light freezing rain
            67: { icon: 'bi-cloud-sleet-fill', class: 'text-blue-300' },  // Heavy freezing rain

            // Snow codes
            71: { icon: 'bi-snow', class: 'text-blue-200' },  // Slight snow fall
            73: { icon: 'bi-snow', class: 'text-blue-200' },  // Moderate snow fall
            75: { icon: 'bi-snow-fill', class: 'text-blue-200' },  // Heavy snow fall

            // Snow grains
            77: { icon: 'bi-snow', class: 'text-blue-200' },  // Snow grains

            // Rain showers
            80: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  // Slight rain showers
            81: { icon: 'bi-cloud-rain-fill', class: 'text-blue-500' },  // Moderate rain showers
            82: { icon: 'bi-cloud-rain-heavy-fill', class: 'text-blue-600' },  // Violent rain showers

            // Snow showers
            85: { icon: 'bi-snow', class: 'text-blue-200' },  // Slight snow showers
            86: { icon: 'bi-snow-fill', class: 'text-blue-200' },  // Heavy snow showers

            // Thunderstorm
            95: { icon: 'bi-cloud-lightning-fill', class: 'text-yellow-600' },  // Thunderstorm
            96: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' },  // Thunderstorm with slight hail
            99: { icon: 'bi-cloud-lightning-rain-fill', class: 'text-yellow-600' }   // Thunderstorm with heavy hail
        };

        return weatherCodes[code] || { icon: 'bi-question-circle', class: 'text-gray-500' };
    }

    async fetchWeatherData() {
        try {
            const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=43.7001&longitude=-79.4163&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=America%2FNew_York');
            const data = await response.json();

            // Process and store weather data
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

    generateCalendar(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';

        for (let i = 0; i < 7; i++) {
            html += `<th>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</th>`;
        }
        html += '</tr></thead><tbody><tr>';

        // Empty cells for days before start of month
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td></td>';
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDate = new Date(d.getFullYear(), d.getMonth(), day);
            const dateStr = moment(dayDate).format('YYYY-MM-DD');
            const weather = this.weatherData.get(dateStr);

            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>';
            }

            html += `
                <td class="day relative" data-date="${dateStr}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold">${day}</span>
                        ${weather ? `
                            <div class="weather-info text-xs flex flex-col items-end">
                                <div class="flex items-center gap-1">
                                    <i class="bi ${this.getWMOIcon(weather.weatherCode).icon} ${this.getWMOIcon(weather.weatherCode).class}"></i>
                                </div>
                                <div class="text-right">
                                    <span class="text-red-500">${weather.maxTemp}°</span>
                                    <span class="text-blue-500">${weather.minTemp}°</span>
                                </div>
                            </div>
                        ` : ''}
                    </div>`;

            // Add events for this day
            const eventsForDay = this.events.filter(event => {
                const eventStart = new Date(event.startTime).setHours(0, 0, 0, 0);
                const eventEnd = new Date(event.endTime).setHours(23, 59, 59, 999);
                return dayDate >= eventStart && dayDate <= eventEnd;
            });

            eventsForDay.forEach(event => {
                html += `
                    <div class="event-bar mt-2" data-eventid="${event.id}" title="${event.title}">
                        ${event.title}
                    </div>`;
            });

            html += `</td>`;
        }

        // Fill in remaining cells
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td></td>';
        }

        html += '</tr></tbody></table>';
        $('#' + this.containerId + ' .col-12').html(html);

        // Add event listeners
        $('.event-bar').click((e) => {
            const eventId = $(e.target).data('eventid');
            this.eventClickHandler(eventId);
        });

        this.updateMonthYear(d);
    }

    updateMonthYear(d) {
        $('#month', '#' + this.containerId).text(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]);
        $('#year', '#' + this.containerId).text(d.getFullYear());

        $('#left', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(-1);
        });

        $('#right', '#' + this.containerId).off('click').click((e) => {
            e.preventDefault();
            this.changeMonth(1);
        });
    }

    async changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        await this.fetchWeatherData(); // Fetch weather data for new month
        this.refreshCalendar();
    }

    async initialize() {
        await this.fetchWeatherData();
        this.constructHTML();
        this.refreshCalendar();
    }
}

// Example usage:
//const myCalendar = new Calendar('calendar');
/*
const newEvents = [
    { id:0,title: "Multi-Day Event", room: "101", startTime: "2024-03-10T00:00:00", endTime: "2024-03-11T23:59:59", description: "This is a multi-day event." },
    { id:1,title: "Single Day Event", room: "102", startTime: "2024-03-10T09:00:00", endTime: "2024-03-12T17:00:00", description: "This is a single-day event." }
]; */

//myCalendar.loadEvents(newEvents);

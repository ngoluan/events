class Calendar {
    constructor(containerId) {
        this.containerId = containerId;
        this.currentDate = new Date();
        this.events = [];
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
    generateCalendar(d) {
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
        const totalDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let html = '<table class="table calendar"><thead><tr>';
        for (let i = 0; i < 7; i++) {
            html += `<th>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</th>`;
        }
        html += '</tr></thead><tbody><tr>';

        // Define room colors
        const roomClasses = {
            "DiningRoom": "event-room-1",
            "Lounge": "event-room-2"
            // Add more rooms and their corresponding classes as needed
        };

        // Filling the first week of the month with empty cells if needed
        for (let i = 0; i < firstDayOfMonth; i++) {
            html += '<td></td>'; // Padding days before the first day of the month
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayDate = new Date(d.getFullYear(), d.getMonth(), day);
            if ((day + firstDayOfMonth - 1) % 7 === 0 && day > 1) {
                html += '</tr><tr>'; // Start a new row at the end of the week
            }

            html += `<td class="day" data-date="${dayDate.toISOString().split('T')[0]}">${day}`;

            // Find events for the current day
            const eventsForDay = this.events.filter(event => {
                const eventStart = new Date(event.startTime).setHours(0, 0, 0, 0);
                const eventEnd = new Date(event.endTime).setHours(23, 59, 59, 999);
                return dayDate >= eventStart && dayDate <= eventEnd;
            });

            // Render events
            eventsForDay.forEach(event => {
                html += `<div class="event-bar" data-eventid="${event.id}" title="${event.title}: ${event.description}">
          ${event.title}
        </div>`;
            });

            html += `</td>`;
        }

        // Fill the last week of the month with empty cells if needed
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth(), totalDays).getDay();
        for (let i = lastDayOfMonth; i < 6; i++) {
            html += '<td></td>'; // Padding days after the last day of the month
        }

        html += '</tr></tbody></table>';
        $('#' + this.containerId + ' .col-12').html(html);

        // Bind click events to event bars
        $('.event-bar').click((e) => {
            const eventId = $(e.target).data('eventid');
            this.eventClickHandler(eventId);
        });

        // Call updateMonthYear to set the current month and year in the calendar header
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

    changeMonth(offset) {
        this.currentDate.setMonth(this.currentDate.getMonth() + offset);
        this.refreshCalendar();
    }

    initialize() {
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

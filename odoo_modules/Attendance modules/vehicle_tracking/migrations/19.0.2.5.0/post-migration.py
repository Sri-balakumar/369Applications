# -*- coding: utf-8 -*-
"""Make the trip / fuel / fraud sequences company-agnostic.

They were created with the install-time company, so on any other company
next_by_code() returned False and every record was saved as "New".
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        UPDATE ir_sequence
           SET company_id = NULL
         WHERE code IN ('vehicle.tracking.seq', 'vehicle.fuel.log', 'vehicle.ai.fraud.report')
           AND company_id IS NOT NULL
    """)
    _logger.info("[vehicle_tracking] cleared company on %s sequence(s)", cr.rowcount)
